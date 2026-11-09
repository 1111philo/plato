// What plato knows about addresses SES won't deliver to.
//
// The SES account has account-level suppression on for BOUNCE and COMPLAINT:
// once an address hard-bounces or marks mail as spam, SES accepts every later
// send to it and silently drops it. Without this module plato would report
// "Invite sent" for an address nobody will ever read. Every send path asks
// `getSuppression()` first and skips SES when the address is on the list.
//
// The list is account-wide (shared with other apps on the AWS account), so
// the admin listing is intersected with plato's own addresses by the caller.
//
// Fails open: if SES can't be asked, the email goes out as before. A lookup
// failure must never block an invite or a password reset.
//
// Off Lambda (dev, e2e), with SKIP_EMAIL=true or no AWS credentials, the list
// comes from SUPPRESSED_EMAILS instead: `a@x.com,b@y.com:COMPLAINT` (reason
// defaults to BOUNCE). That env var is ignored on Lambda, like AI_PROVIDER=mock.
// Under `node --test` the env list is used too unless a test injects a client.

import {
  SESv2Client,
  GetSuppressedDestinationCommand,
  ListSuppressedDestinationsCommand,
  DeleteSuppressedDestinationCommand,
} from '@aws-sdk/client-sesv2';
import { logger } from './logger.js';

export const HIT_TTL_MS = 5 * 60 * 1000;
export const MISS_TTL_MS = 60 * 1000;
const LIST_TTL_MS = 5 * 60 * 1000;
const REASONS = new Set(['BOUNCE', 'COMPLAINT']);

let client = null;
const cache = new Map(); // email -> { value, expires }
let listCache = null; // { value, expires }
let warned = false;
let envWarned = false;
let localList = null; // test override: [{ email, reason, since }]

const norm = (email) => String(email || '').trim().toLowerCase();

/** Tests inject a fake SESv2 client (`{ send(cmd) }`) and/or reset state. */
export function _setSesClient(c) { client = c; }
export function _resetSuppression() {
  cache.clear(); listCache = null; warned = false; envWarned = false; localList = null; client = null;
}

function onLambda() { return !!process.env.AWS_LAMBDA_FUNCTION_NAME; }

function useEnvList() {
  if (onLambda()) {
    if (process.env.SUPPRESSED_EMAILS && !envWarned) {
      envWarned = true;
      console.error('SUPPRESSED_EMAILS ignored on Lambda; using SES');
    }
    return false;
  }
  if (client) return false; // a test injected SES
  if (process.env.SKIP_EMAIL === 'true') return true;
  if (process.env.NODE_TEST_CONTEXT) return true; // node --test never calls real SES
  const e = process.env;
  return !(e.AWS_ACCESS_KEY_ID || e.AWS_PROFILE || e.AWS_CONTAINER_CREDENTIALS_FULL_URI || e.AWS_WEB_IDENTITY_TOKEN_FILE);
}

/** Parse SUPPRESSED_EMAILS into `[{ email, reason, since }]`. */
export function parseSuppressedEnv(raw = process.env.SUPPRESSED_EMAILS) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const i = entry.lastIndexOf(':');
    const maybe = i > 0 ? entry.slice(i + 1).trim().toUpperCase() : '';
    const reason = REASONS.has(maybe) ? maybe : 'BOUNCE';
    const email = norm(REASONS.has(maybe) ? entry.slice(0, i) : entry);
    return { email, reason, since: null };
  }).filter((e) => e.email.includes('@'));
}

function envList() { return localList || parseSuppressedEnv(); }

function ses() {
  if (!client) client = new SESv2Client({});
  return client;
}

function failOpen(err, op) {
  if (!warned) {
    warned = true;
    logger.warn('email_suppression_check_failed', { op, error: err?.name || String(err?.message || err).slice(0, 200) });
  }
}

const isNotFound = (err) => err?.name === 'NotFoundException' || err?.$metadata?.httpStatusCode === 404;
const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * Is this address on the suppression list? `null`, or
 * `{ reason: 'BOUNCE' | 'COMPLAINT', since: ISO string | null }`.
 * Never throws.
 */
export async function getSuppression(email) {
  const key = norm(email);
  if (!key) return null;
  if (useEnvList()) {
    const hit = envList().find((e) => e.email === key);
    return hit ? { reason: hit.reason, since: hit.since } : null;
  }
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  let value = null;
  try {
    const out = await ses().send(new GetSuppressedDestinationCommand({ EmailAddress: key }));
    const d = out?.SuppressedDestination;
    if (d) value = { reason: d.Reason === 'COMPLAINT' ? 'COMPLAINT' : 'BOUNCE', since: iso(d.LastUpdateTime) };
  } catch (err) {
    if (!isNotFound(err)) {
      failOpen(err, 'get');
      // Cache the miss briefly so a broken SES doesn't add a call per send.
      cache.set(key, { value: null, expires: Date.now() + MISS_TTL_MS });
      return null;
    }
  }
  cache.set(key, { value, expires: Date.now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
  return value;
}

/**
 * The whole account-wide list, `[{ email, reason, since }]`. Callers must
 * intersect it with plato's own addresses before showing it to anyone.
 * Returns `null` when SES can't be asked (fail open: no badges).
 */
export async function listSuppressed() {
  if (useEnvList()) return envList();
  if (listCache && listCache.expires > Date.now()) return listCache.value;
  try {
    const out = [];
    let NextToken;
    do {
      const page = await ses().send(new ListSuppressedDestinationsCommand({ Reasons: ['BOUNCE', 'COMPLAINT'], PageSize: 1000, NextToken }));
      for (const d of page?.SuppressedDestinationSummaries || []) {
        out.push({ email: norm(d.EmailAddress), reason: d.Reason === 'COMPLAINT' ? 'COMPLAINT' : 'BOUNCE', since: iso(d.LastUpdateTime) });
      }
      NextToken = page?.NextToken;
    } while (NextToken);
    listCache = { value: out, expires: Date.now() + LIST_TTL_MS };
    return out;
  } catch (err) {
    failOpen(err, 'list');
    return null;
  }
}

/** Take an address off the list (the admin fixed or confirmed it). Throws on SES error. */
export async function removeSuppression(email) {
  const key = norm(email);
  if (useEnvList()) {
    localList = envList().filter((e) => e.email !== key);
  } else {
    try {
      await ses().send(new DeleteSuppressedDestinationCommand({ EmailAddress: key }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  cache.delete(key);
  listCache = null;
}

/** Log a skipped send. The address stays out of the logs. */
export function logSuppressed(template, suppression) {
  logger.warn('email_suppressed', { template, reason: suppression.reason });
}
