/**
 * Notifications (#388, #389, #400): the email side. One place for
 * - **automations**: `_system:automations` = `{ waitlistConfirmation,
 *   inactivityNudge, weeklyDigest }`, every one OFF until an admin turns it on;
 * - **templates**: defaults below, admin overrides in
 *   `_system:emailTemplate:<id>` (`{ subject, body }`). A body is plain text:
 *   paragraphs separated by blank lines, `{{variables}}` filled in (and
 *   HTML-escaped in the HTML part), and a line holding only `{{link}}` becomes
 *   a button;
 * - **sending**: multipart text + HTML through SES (raw MIME, so we can add
 *   `List-Unsubscribe` + one-click `List-Unsubscribe-Post`), skipped with
 *   SKIP_EMAIL, and limited to `EMAIL_ALLOWLIST` when that's set (non-prod:
 *   playground users are real people);
 * - **unsubscribe**: HMAC-signed tokens per user and kind (`nudge`, `digest`,
 *   `messages`), honored through the per-user server-only `notify:state`
 *   record, which learners can't write through /v1/sync.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { JWT_SECRET, SES_FROM_EMAIL, APP_URL } from '../config.js';
import defaultDb from './db.js';
import { escapeHtml, safeColor, emailWrapper, getClassroom } from './email.js';
import { logger } from './logger.js';

let ses = null;
const sesClient = () => (ses ||= new SESClient({}));
const sesTransport = (raw) => sesClient().send(new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } }));
let transport = sesTransport;

/** Tests swap the transport (raw MIME string → Promise); null restores SES. */
export function setEmailTransport(fn) {
  transport = fn || sesTransport;
}

// ── Automations ──────────────────────────────────────────────────────────

export const AUTOMATIONS = Object.freeze({
  waitlistConfirmation: { label: 'Wait list confirmation', template: 'waitlist-confirmation' },
  inactivityNudge: { label: 'Inactivity reminder', template: 'inactivity-nudge' },
  weeklyDigest: { label: 'Weekly digest', template: 'weekly-digest' },
});

export async function readAutomations(db = defaultDb) {
  const item = await db.getSyncData('_system', 'automations');
  const stored = item?.data || {};
  return Object.fromEntries(Object.keys(AUTOMATIONS).map((k) => [k, stored[k] === true]));
}

/** Set some automations on or off; returns the full set. Unknown keys and non-booleans are refused. */
export async function writeAutomations(patch, db = defaultDb) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!AUTOMATIONS[k]) return { error: `Unknown automation: ${k}` };
    if (typeof v !== 'boolean') return { error: `${k} must be true or false` };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const item = await db.getSyncData('_system', 'automations');
    const next = { ...(item?.data || {}), ...patch };
    try {
      await db.putSyncData('_system', 'automations', next, item?.version || 0);
      return { automations: await readAutomations(db) };
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException' || attempt === 1) throw err;
    }
  }
  return { error: 'Try again' };
}

// ── Templates ────────────────────────────────────────────────────────────

export const MAX_SUBJECT = 200;
export const MAX_BODY = 5000;

export const TEMPLATES = Object.freeze({
  'waitlist-confirmation': {
    label: 'Wait list confirmation',
    description: 'Sent once, when someone joins the wait list.',
    variables: ['firstName', 'classroomName'],
    subject: "You're on the wait list for {{classroomName}}",
    body: "Hi {{firstName}},\n\nThanks for joining the wait list for {{classroomName}}. We'll email you again when there's a place for you, with a link to create your account.\n\nYou don't need to do anything until then.",
  },
  'inactivity-nudge': {
    label: 'Inactivity reminder',
    description: 'Sent when a learner hasn’t worked on a lesson they started for 7 days.',
    variables: ['firstName', 'classroomName', 'lessonName', 'progress', 'link'],
    linkLabel: 'Continue the lesson',
    subject: 'Pick up where you left off: {{lessonName}}',
    body: "Hi {{firstName}},\n\nIt's been a week since you worked on {{lessonName}} in {{classroomName}}, and you're {{progress}} of the way there. Your coach remembers where you left off.\n\n{{link}}",
  },
  'weekly-digest': {
    label: 'Weekly digest',
    description: 'A weekly summary of the learner’s progress and new lessons. Skipped when there’s nothing to say.',
    variables: ['firstName', 'classroomName', 'progressSummary', 'newLessons', 'link'],
    linkLabel: 'Open {{classroomName}}',
    subject: 'Your week in {{classroomName}}',
    body: 'Hi {{firstName}},\n\n{{progressSummary}}\n\n{{newLessons}}\n\n{{link}}',
  },
});

const VAR_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** The template an admin sees and edits: their override or the default. */
export async function getTemplate(id, db = defaultDb) {
  const def = TEMPLATES[id];
  if (!def) return null;
  const item = await db.getSyncData('_system', `emailTemplate:${id}`);
  const o = item?.data || {};
  return {
    id, label: def.label, description: def.description, variables: def.variables,
    subject: typeof o.subject === 'string' ? o.subject : def.subject,
    body: typeof o.body === 'string' ? o.body : def.body,
    isDefault: !item,
    updatedByName: o.updatedByName || null,
    updatedAt: item?.updatedAt || null,
  };
}

/** Check a subject/body pair against a template's variables. Returns an error string or null. */
export function validateTemplate(id, { subject, body }, variables = TEMPLATES[id]?.variables || []) {
  if (typeof subject !== 'string' || !subject.trim()) return 'Subject is required';
  if (/[\r\n]/.test(subject)) return 'Subject must be one line';
  if (subject.length > MAX_SUBJECT) return `Subject must be at most ${MAX_SUBJECT} characters`;
  if (typeof body !== 'string' || !body.trim()) return 'Message is required';
  if (body.length > MAX_BODY) return `Message must be at most ${MAX_BODY} characters`;
  const unknown = [...`${subject}\n${body}`.matchAll(VAR_RE)].map((m) => m[1]).filter((v) => !variables.includes(v));
  if (unknown.length) {
    return `Unknown ${unknown.length === 1 ? 'variable' : 'variables'}: ${[...new Set(unknown)].map((v) => `{{${v}}}`).join(', ')}. You can use ${variables.map((v) => `{{${v}}}`).join(', ')}.`;
  }
  return null;
}

export async function putTemplate(id, { subject, body }, actor, db = defaultDb) {
  if (!TEMPLATES[id]) return { error: 'Unknown template', status: 404 };
  const error = validateTemplate(id, { subject, body });
  if (error) return { error, status: 400 };
  const item = await db.getSyncData('_system', `emailTemplate:${id}`);
  await db.putSyncData('_system', `emailTemplate:${id}`, {
    subject: subject.trim(), body: body.replace(/\r\n/g, '\n').trim(),
    updatedBy: actor.userId, updatedByName: actor.username || actor.email,
  }, item?.version || 0);
  return { template: await getTemplate(id, db) };
}

export async function resetTemplate(id, db = defaultDb) {
  if (!TEMPLATES[id]) return { error: 'Unknown template', status: 404 };
  if (await db.getSyncData('_system', `emailTemplate:${id}`)) await db.deleteSyncData('_system', `emailTemplate:${id}`);
  return { template: await getTemplate(id, db) };
}

const fill = (s, vars) => s.replace(VAR_RE, (_, k) => (vars[k] == null ? '' : String(vars[k])));

/**
 * `{ subject, text, html }` for a subject/body pair. Variables are filled in
 * (escaped in HTML; multi-line values keep their line breaks). A paragraph
 * that's only `{{link}}` becomes a button labelled `linkLabel`.
 */
export function renderEmail({ subject, body }, vars, { classroom, linkLabel = 'Open', footerHtml = '', footerText = '' } = {}) {
  const link = vars.link || '';
  const outSubject = fill(subject, vars).replace(/[\r\n]+/g, ' ').trim();
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const text = paragraphs.map((p) => fill(p, vars)).filter((p) => p.trim()).join('\n\n') + '\n' + (footerText ? `\n${footerText}\n` : '');
  const primary = safeColor(classroom?.primary);
  const htmlParas = paragraphs.map((p) => {
    if (/^\{\{\s*link\s*\}\}$/.test(p)) {
      if (!link) return '';
      return `<p style="margin: 0 0 16px;"><a href="${escapeHtml(link)}" style="display: inline-block; background: ${primary}; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">${escapeHtml(fill(linkLabel, vars))}</a></p>`;
    }
    const html = escapeHtml(p).replace(VAR_RE, (_, k) => escapeHtml(vars[k] == null ? '' : String(vars[k])));
    if (!html.trim()) return '';
    return `<p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 16px;">${html.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return { subject: outSubject, text, html: emailWrapper(classroom || { name: 'plato' }, htmlParas, footerHtml) };
}

// ── Unsubscribe ──────────────────────────────────────────────────────────

export const UNSUBSCRIBE_KINDS = Object.freeze({
  nudge: 'inactivity reminder',
  digest: 'weekly digest',
  messages: 'messages from your classroom',
});

const unsubscribeKey = () => createHmac('sha256', JWT_SECRET).update('plato-unsubscribe-v1').digest();
const sign = (payload) => createHmac('sha256', unsubscribeKey()).update(payload).digest('base64url');

export function unsubscribeToken(userId, kind) {
  const payload = Buffer.from(JSON.stringify({ u: userId, k: kind })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** `{ userId, kind }` for a valid token, else null. */
export function verifyUnsubscribeToken(token) {
  const [payload, mac] = String(token || '').split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { u, k } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof u === 'string' && UNSUBSCRIBE_KINDS[k] ? { userId: u, kind: k } : null;
  } catch {
    return null;
  }
}

export const unsubscribeUrl = (userId, kind) => `${APP_URL}/v1/unsubscribe?token=${unsubscribeToken(userId, kind)}`;

// ── Per-user state (server-only) ─────────────────────────────────────────

const STATE_KEY = 'notify:state';

export async function readNotifyState(userId, db = defaultDb) {
  const item = await db.getSyncData(userId, STATE_KEY);
  return { optOut: {}, ...(item?.data || {}) };
}

/**
 * Read-modify-write with one retry on a lost race. If `change` returns its
 * argument unchanged (the same object), nothing is written.
 */
export async function updateNotifyState(userId, change, db = defaultDb) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const item = await db.getSyncData(userId, STATE_KEY);
    const cur = { optOut: {}, ...(item?.data || {}) };
    const next = change(cur);
    if (next === cur) return cur;
    try {
      await db.putSyncData(userId, STATE_KEY, next, item?.version || 0);
      return next;
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException' || attempt === 1) throw err;
    }
  }
  return null;
}

/** Set opt-outs; `optOut` maps a kind to true (no email) or false. */
export async function setOptOut(userId, optOut, db = defaultDb) {
  for (const [k, v] of Object.entries(optOut || {})) {
    if (!UNSUBSCRIBE_KINDS[k] || typeof v !== 'boolean') return { error: `Unknown email setting: ${k}` };
  }
  const next = await updateNotifyState(userId, (s) => ({ ...s, optOut: { ...s.optOut, ...optOut } }), db);
  return { optOut: next.optOut };
}

// ── Sending ──────────────────────────────────────────────────────────────

/**
 * EMAIL_ALLOWLIST: comma-separated addresses and `@domain`s. When it's unset,
 * anyone on prod (or a self-hosted install, or local dev) and **no one** on
 * another deployed stage, so playground can't email its real users by accident.
 */
export function emailAllowed(address, allowlist = process.env.EMAIL_ALLOWLIST, stage = process.env.STAGE) {
  const list = String(allowlist || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return !stage || stage === 'prod';
  const a = String(address || '').trim().toLowerCase();
  return list.some((e) => (e.startsWith('@') ? a.endsWith(e) : a === e));
}

const asciiOnly = (s) => /^[\x20-\x7e]*$/.test(s);
const encodeWord = (s) => (asciiOnly(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

/** A multipart/alternative MIME message. Header values are forced onto one line. */
export function buildMime({ fromName, fromAddress, to, subject, text, html, headers = {} }) {
  const boundary = `plato_${randomBytes(12).toString('hex')}`;
  const name = oneLine(fromName || 'plato').replace(/["<>\\]/g, '') || 'plato';
  return [
    `From: ${asciiOnly(name) ? `"${name}"` : encodeWord(name)} <${oneLine(fromAddress)}>`,
    `To: ${oneLine(to)}`,
    `Subject: ${encodeWord(oneLine(subject))}`,
    'MIME-Version: 1.0',
    ...Object.entries(headers).map(([k, v]) => `${k}: ${oneLine(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/**
 * Send one notification email. Returns `{ sent | skipped | blocked: true }`.
 * `unsubscribe` (a URL) adds the List-Unsubscribe headers.
 */
export async function sendNotificationEmail({ to, subject, text, html, classroom, unsubscribe = null, send = transport }) {
  if (!emailAllowed(to)) {
    logger.warn('email_not_allowlisted', { to: String(to).replace(/^[^@]*/, '***') });
    return { blocked: true };
  }
  if (process.env.SKIP_EMAIL === 'true') {
    console.log(`[SKIP_EMAIL] ${subject} → ${to}`);
    return { skipped: true };
  }
  const headers = unsubscribe
    ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : {};
  await send(buildMime({ fromName: classroom?.name, fromAddress: SES_FROM_EMAIL, to, subject, text, html, headers }));
  return { sent: true };
}

/**
 * Render a stored template for one recipient and send it. `kind` (an
 * UNSUBSCRIBE_KINDS key) adds an unsubscribe link and honors the user's
 * opt-out; leave it out for one-time transactional mail.
 */
export async function sendTemplated(id, { to, userId = null, kind = null, vars = {} }, { db = defaultDb, send } = {}) {
  if (kind && userId) {
    const state = await readNotifyState(userId, db);
    if (state.optOut?.[kind]) return { optedOut: true };
  }
  const [template, classroom] = await Promise.all([getTemplate(id, db), getClassroom()]);
  const allVars = { classroomName: classroom.name, ...vars };
  const unsubscribe = kind && userId ? unsubscribeUrl(userId, kind) : null;
  const label = kind ? UNSUBSCRIBE_KINDS[kind] : null;
  const rendered = renderEmail(template, allVars, {
    classroom,
    linkLabel: TEMPLATES[id].linkLabel,
    ...(unsubscribe ? {
      footerText: `To stop getting the ${label}, unsubscribe: ${unsubscribe}`,
      footerHtml: `<p style="color: #777; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">Don’t want the ${escapeHtml(label)}? <a href="${escapeHtml(unsubscribe)}" style="color: #777;">Unsubscribe</a>.</p>`,
    } : {}),
  });
  return sendNotificationEmail({ to, ...rendered, classroom, unsubscribe, send });
}
