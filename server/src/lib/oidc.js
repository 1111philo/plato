/**
 * OpenID Connect, the parts every sign-in provider shares (authorization code
 * flow with PKCE). Provider-neutral: a provider is just an issuer URL, a
 * client id and secret, and a claims mapper (plugins supply those; see
 * lib/sso-providers.js). Nothing here knows about users or sessions.
 *
 * What it guarantees:
 * - `state`, `nonce`, and the PKCE verifier are random per attempt and travel
 *   in a signed, short-lived value (`seal`) kept in an HttpOnly cookie.
 * - The ID token's signature (provider's JWKS, RS256 only), issuer, audience,
 *   expiry, and nonce are all checked. The issuer in the discovery document
 *   must equal the configured one.
 * - Endpoints must be https (http only for localhost, for tests and dev).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { JWT_SECRET, APP_URL } from '../config.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const randomToken = (bytes = 32) => b64u(randomBytes(bytes));
export const sha256 = (value) => b64u(createHash('sha256').update(value).digest());
export const pkceChallenge = (verifier) => sha256(verifier);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── Signed values (the transaction cookie, the wait-list ticket) ──────────
// HMAC with a key derived from JWT_SECRET and the purpose, so a value sealed
// for one purpose never verifies for another, and none is a session token.
const keyFor = (purpose) => createHmac('sha256', JWT_SECRET).update(`plato-sso:${purpose}`).digest();

export function seal(purpose, payload, ttlSeconds, now = Date.now()) {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `${body}.${b64u(createHmac('sha256', keyFor(purpose)).update(body).digest())}`;
}

export function unseal(purpose, value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const [body, sig, extra] = value.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, b64u(createHmac('sha256', keyFor(purpose)).update(body).digest()))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // issuer -> { doc, jwks, at }

const isLocal = (url) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
function requireHttps(url, what) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(url))) throw oidcError('insecure_endpoint', `${what} must be https`);
}

export function oidcError(code, message) {
  return Object.assign(new Error(message || code), { code });
}

/** `{ doc, jwks }` for an issuer, cached an hour. `jwks` refetches on an unknown key id (rotation). */
export async function discover(issuer, { now = Date.now() } = {}) {
  const hit = cache.get(issuer);
  if (hit && now - hit.at < DISCOVERY_TTL_MS) return hit;
  requireHttps(issuer, 'issuer');
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw oidcError('discovery_failed', `discovery returned ${res.status}`);
  const doc = await res.json();
  if (doc.issuer !== issuer) throw oidcError('issuer_mismatch', 'discovery issuer differs from the configured one');
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof doc[k] !== 'string') throw oidcError('discovery_failed', `discovery lacks ${k}`);
    requireHttps(doc[k], k);
  }
  const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: 8000 }), at: now };
  cache.set(issuer, entry);
  return entry;
}

/** For tests. */
export function _resetOidcCache() { cache.clear(); }

// ── The flow ──────────────────────────────────────────────────────────────
/** A new attempt: `{ state, nonce, verifier }`. */
export const newAttempt = () => ({ state: randomToken(), nonce: randomToken(), verifier: randomToken(48) });

export function authorizeUrl({ doc, clientId, redirectUri, scope, attempt, extra = {} }) {
  const url = new URL(doc.authorization_endpoint);
  const params = {
    ...extra,
    response_type: 'code',
    response_mode: 'query',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: pkceChallenge(attempt.verifier),
    code_challenge_method: 'S256',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Trade the authorization code for an ID token. The secret goes in the body, never a URL. */
export async function exchangeCode({ doc, clientId, clientSecret, redirectUri, code, verifier }) {
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: verifier }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.id_token !== 'string') {
    // The provider's error code only (e.g. invalid_grant); never the body, which can echo secrets.
    // Entra puts its own code (AADSTS…) in the description; keep just that.
    const aadsts = typeof body?.error_description === 'string' ? (body.error_description.match(/AADSTS\d+/) || [''])[0] : '';
    const reason = typeof body?.error === 'string' ? body.error.replace(/[^a-z_]/gi, '').slice(0, 40) : `status ${res.status}`;
    throw oidcError('token_exchange_failed', `${reason}${aadsts ? ` ${aadsts}` : ''}`);
  }
  return body.id_token;
}

/** The ID token's claims, after signature, issuer, audience, expiry, and nonce checks. */
export async function verifyIdToken(idToken, { doc, jwks, clientId, nonce }) {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, { issuer: doc.issuer, audience: clientId, algorithms: ['RS256'], clockTolerance: 60, requiredClaims: ['exp', 'iat', 'sub'] }));
  } catch (err) {
    throw oidcError('id_token_invalid', err?.code || err?.message);
  }
  if (!nonce || !safeEqual(payload.nonce, nonce)) throw oidcError('id_token_invalid', 'nonce mismatch');
  return payload;
}

/**
 * A post-sign-in destination: a path on this site, else '/'. Browsers strip
 * tabs and newlines from URLs and treat a backslash as a slash, so
 * "/<tab>/evil.example" would leave the site: refuse control characters and
 * backslashes outright, then let the URL parser confirm the origin.
 */
export function safeNextPath(next, base = APP_URL) {
  if (typeof next !== 'string' || !next || next.length > 300) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(next) || !next.startsWith('/') || next.startsWith('//')) return '/';
  try {
    const origin = new URL(base).origin;
    const url = new URL(next, origin);
    if (url.origin !== origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
