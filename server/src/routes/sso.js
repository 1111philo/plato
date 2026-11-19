/**
 * Single sign-on routes. Core owns the whole flow; a plugin only supplies the
 * provider (lib/sso-providers.js). All paths are under /v1/auth/, so the
 * CloudFront WAF rate rule and the origin check already cover them.
 *
 *   GET  /v1/auth/sso/providers            → the buttons to show (public)
 *   GET  /v1/auth/sso/:provider/start      → redirect to the provider
 *   POST /v1/auth/sso/:provider/link       → same, to connect it to the signed-in account
 *   GET  /v1/auth/sso/:provider/callback   → the provider redirects back here
 *   POST /v1/auth/sso/exchange             → the app trades its one-time code for the result
 *   POST /v1/auth/sso/disconnect           → remove the link from your own account
 *
 * Tokens never travel in a URL. The callback stores the outcome under a
 * one-time code (60 s, single use) and redirects to the app with the code in
 * the URL fragment; the app posts it back with the transaction cookie, and
 * only then is a session issued. The code is useless without that cookie.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import db from '../lib/db.js';
import { APP_URL } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';
import { clientIp, createLimiter, readJson } from '../lib/rate-limit.js';
import { issueSession } from '../lib/sessions.js';
import { comparePassword } from '../lib/password.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { nameFields } from '../lib/names.js';
import { normalizeRole } from '../lib/permissions.js';
import { logger } from '../lib/logger.js';
import { readWaitlistConfig } from '../lib/waitlist.js';
import { sendSsoLinkedEmail } from '../lib/notifications.js';
import { getProvider, liveProviders } from '../lib/sso-providers.js';
import { resolveSignIn, finishLink } from '../lib/external-identity.js';
import {
  authorizeUrl, discover, exchangeCode, newAttempt, randomToken, safeEqual, safeNextPath, seal, sha256, unseal, verifyIdToken,
} from '../lib/oidc.js';

const sso = new Hono();

// `__Secure-`: a browser only accepts it over https with the Secure flag, so a
// sibling host can't plant one. Plain name for http (local dev, tests).
const SECURE = APP_URL.startsWith('https://');
const TX_COOKIE = SECURE ? '__Secure-plato_sso_tx' : 'plato_sso_tx';
const TX_TTL_SECONDS = 10 * 60; // long enough for an MFA prompt or a password reset at the provider
const CODE_TTL_SECONDS = 60;
export const TICKET_TTL_SECONDS = 15 * 60;
const TEN_MIN = 10 * 60 * 1000;
// Flood guards per IP (a room of learners shares one address; see routes/auth.js).
const starts = createLimiter({ limit: 1000, windowMs: TEN_MIN });
// Its own budget: each callback costs a call to the provider's token endpoint.
const callbacks = createLimiter({ limit: 1000, windowMs: TEN_MIN });
const exchanges = createLimiter({ limit: 1000, windowMs: TEN_MIN });
const TOO_MANY = { error: 'Too many requests. Please try again later.' };

const cookieOptions = () => ({ httpOnly: true, secure: SECURE, sameSite: 'Lax', path: '/v1/auth/sso', maxAge: TX_TTL_SECONDS });
// A `__Secure-` cookie can only be set, or cleared, with the Secure attribute.
const clearTx = (c) => deleteCookie(c, TX_COOKIE, { path: '/v1/auth/sso', secure: SECURE });
const redirectUri = (providerId) => `${APP_URL}/v1/auth/sso/${providerId}/callback`;
const codeKey = (code) => sha256(`sso-code:${code}`);
const toLogin = (c, reason) => c.redirect(`${APP_URL}/login?sso=${encodeURIComponent(reason)}`, 302);

// Nothing here may be cached: these responses set cookies and carry codes.
sso.use('/v1/auth/sso/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// `style` (icon and colors, validated in lib/sso-button-style.js) only when an admin set one.
sso.get('/v1/auth/sso/providers', (c) => c.json({
  providers: liveProviders().map((p) => ({ id: p.id, label: p.label, ...(p.style ? { style: p.style } : {}) })),
}));

async function begin(c, provider, extra) {
  const { doc } = await discover(provider.cfg.issuer);
  const attempt = newAttempt();
  setCookie(c, TX_COOKIE, seal('tx', { p: provider.id, ...attempt, ...extra }, TX_TTL_SECONDS), cookieOptions());
  return authorizeUrl({
    doc, clientId: provider.cfg.clientId, redirectUri: redirectUri(provider.id),
    scope: provider.cfg.scope || 'openid profile email', attempt, extra: provider.cfg.authorizeParams || {},
  });
}

sso.get('/v1/auth/sso/:provider/start', async (c) => {
  if (starts.hit(clientIp(c))) return c.json(TOO_MANY, 429);
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return toLogin(c, 'unavailable');
  const invite = c.req.query('invite');
  try {
    const url = await begin(c, provider, {
      next: safeNextPath(c.req.query('next')),
      ...(typeof invite === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(invite) ? { invite } : {}),
    });
    return c.redirect(url, 302);
  } catch (err) {
    logger.error('sso_start_failed', { provider: provider.id, reason: err?.code || 'error' });
    return toLogin(c, 'unavailable');
  }
});

// Connect the provider to the signed-in account (Settings). A page navigation
// can't carry the Bearer token, so the app asks for the URL first. Adding a
// way to sign in is a credential change: it needs the current password, like
// changing the password or email (a stolen session alone must not be enough).
sso.post('/v1/auth/sso/:provider/link', authenticate, async (c) => {
  if (starts.hit(clientIp(c))) return c.json(TOO_MANY, 429);
  const provider = getProvider(c.req.param('provider'));
  if (!provider) return c.json({ error: 'This sign-in method isn’t available' }, 404);
  const body = await readJson(c);
  const user = await db.getUserById(c.get('user').userId);
  if (!user) return c.json({ error: 'Not found' }, 404);
  if (user.ssoKey) return c.json({ error: 'This account already has a connected sign-in. Disconnect it first.', code: 'account_has_identity' }, 400);
  if (typeof body?.currentPassword !== 'string' || !(await comparePassword(body.currentPassword, user.passwordHash))) {
    return c.json({ error: 'Your current password is incorrect', code: 'wrong_password' }, 400);
  }
  try {
    return c.json({ url: await begin(c, provider, { next: '/settings', link: user.userId }) });
  } catch (err) {
    logger.error('sso_start_failed', { provider: provider.id, reason: err?.code || 'error' });
    return c.json({ error: 'This sign-in method isn’t available right now' }, 502);
  }
});

sso.get('/v1/auth/sso/:provider/callback', async (c) => {
  if (callbacks.hit(clientIp(c))) return c.json(TOO_MANY, 429);
  const providerId = c.req.param('provider');
  const tx = unseal('tx', getCookie(c, TX_COOKIE));
  // No cookie, a cookie for another provider, or a state that isn't ours: stop
  // before talking to the provider (this is the login-CSRF check).
  if (!tx || tx.p !== providerId || !safeEqual(c.req.query('state'), tx.state)) {
    clearTx(c);
    return toLogin(c, 'expired');
  }
  if (c.req.query('error')) {
    clearTx(c);
    return toLogin(c, 'cancelled');
  }
  const provider = getProvider(providerId);
  const code = c.req.query('code');
  if (!provider || typeof code !== 'string' || !code) {
    clearTx(c);
    return toLogin(c, 'failed');
  }

  let result;
  let identity;
  try {
    const { doc, jwks } = await discover(provider.cfg.issuer);
    const idToken = await exchangeCode({ doc, clientId: provider.cfg.clientId, clientSecret: provider.cfg.clientSecret, redirectUri: redirectUri(provider.id), code, verifier: tx.verifier });
    const claims = await verifyIdToken(idToken, { doc, jwks, clientId: provider.cfg.clientId, nonce: tx.nonce });
    identity = provider.mapClaims(claims, provider.cfg);
    result = await resolveSignIn({
      providerId: provider.id, identity, inviteToken: tx.invite || null, linkUserId: tx.link || null,
      notifyLinked: (user, info) => sendSsoLinkedEmail(user.email, { firstName: nameFields(user).firstName, providerLabel: provider.label, ssoEmail: identity.email, ...info }),
    });
  } catch (err) {
    // The code only: never the token, claims, or provider response.
    // `detail` is the provider's own error code for a refused token exchange
    // (e.g. "invalid_client AADSTS7000215"): what an operator needs, and no secret.
    logger.error('sso_callback_failed', { provider: provider.id, reason: err?.code || 'error', ...(err?.code === 'token_exchange_failed' ? { detail: err.message } : {}) });
    clearTx(c);
    return toLogin(c, err?.code === 'identity_refused' ? 'refused' : 'failed');
  }

  const oneTime = randomToken();
  await db.storeOneTimeCode(codeKey(oneTime), {
    bind: sha256(tx.nonce), // ties the code to this browser's transaction cookie
    provider: provider.id,
    label: provider.label,
    next: tx.link ? '/settings' : safeNextPath(tx.next),
    result,
    // What the "no account yet" screen shows, and what a wait-list join may trust.
    person: result.outcome === 'no_account'
      ? { email: identity.email || null, verified: (identity.emails || []).includes(identity.email), firstName: identity.firstName || '', lastName: identity.lastName || '' }
      : null,
  }, CODE_TTL_SECONDS);
  return c.redirect(`${APP_URL}/sso/complete#code=${oneTime}`, 302);
});

sso.post('/v1/auth/sso/exchange', async (c) => {
  if (exchanges.hit(clientIp(c))) return c.json(TOO_MANY, 429);
  const body = await readJson(c);
  const tx = unseal('tx', getCookie(c, TX_COOKIE));
  clearTx(c);
  const code = body?.code;
  const stored = typeof code === 'string' && code.length <= 200 ? await db.takeOneTimeCode(codeKey(code)) : null;
  if (!stored || !tx || !safeEqual(stored.bind, sha256(tx.nonce))) {
    return c.json({ error: 'This sign-in link has expired. Please try again.', code: 'sso_expired' }, 400);
  }
  let { result } = stored;
  // "Connect" from Settings is finished here, and only for the signed-in
  // person who started it: the Bearer token must be theirs.
  if (result.outcome === 'pending_link') {
    const bearer = (c.req.header('Authorization') || '').replace(/^Bearer /, '');
    const session = bearer ? await verifyAccessToken(bearer).catch(() => null) : null;
    const sessionUser = session?.sub ? await db.getUserById(session.sub) : null;
    const current = sessionUser && (Number(sessionUser.tokenVersion) || 0) === (Number(session.tv) || 0) ? sessionUser : null;
    result = current && current.userId === result.userId
      ? await finishLink({
        providerId: stored.provider, pending: result, userId: current.userId,
        notifyLinked: (user, info) => sendSsoLinkedEmail(user.email, { firstName: nameFields(user).firstName, providerLabel: stored.label, ssoEmail: result.email, ...info }),
      })
      : { outcome: 'error', code: 'try_again' };
  }
  const base = { outcome: result.outcome, provider: stored.provider, label: stored.label, next: stored.next };

  if (result.outcome === 'signed_in') {
    const user = await db.getUserById(result.userId);
    if (!user) return c.json({ error: 'This sign-in link has expired. Please try again.', code: 'sso_expired' }, 400);
    const { accessToken, refreshToken } = await issueSession(user);
    try {
      await db.createAuditLog({ action: 'user_login', userId: user.userId, email: user.email, performedBy: user.userId, details: { via: 'sso', provider: stored.provider } });
      await db.setUserActivityField(user.userId, 'lastActiveAt', new Date().toISOString());
    } catch { /* best-effort, as in password sign-in */ }
    return c.json({
      ...base, created: !!result.created, linked: !!result.linked, passwordRemoved: !!result.passwordRemoved, accessToken, refreshToken,
      user: { userId: user.userId, email: user.email, username: user.username, ...nameFields(user), role: normalizeRole(user.role) },
    });
  }
  if (result.outcome === 'linked') return c.json(base);
  if (result.outcome === 'no_account') {
    const { config } = await readWaitlistConfig();
    const person = stored.person || {};
    return c.json({
      ...base, onWaitlist: !!result.onWaitlist, waitlistOpen: !!config.open,
      email: person.email, firstName: person.firstName, lastName: person.lastName,
      // Lets the wait-list form trust this name and email (POST /v1/waitlist `ssoTicket`).
      ticket: person.email && person.verified && !result.onWaitlist
        ? seal('waitlist', { provider: stored.provider, email: person.email, firstName: person.firstName, lastName: person.lastName }, TICKET_TTL_SECONDS)
        : null,
    });
  }
  return c.json({ ...base, outcome: 'error', code: result.code || 'failed' });
});

// Remove the link from your own account. Needs the current password (a
// credential change), which also means it's never the only way in.
sso.post('/v1/auth/sso/disconnect', authenticate, async (c) => {
  const body = await readJson(c);
  const user = await db.getUserById(c.get('user').userId);
  if (!user?.ssoKey) return c.json({ ok: true });
  if (!user.passwordHash) return c.json({ error: 'Set a password first, so you can still sign in.', code: 'no_password' }, 400);
  if (typeof body?.currentPassword !== 'string' || !(await comparePassword(body.currentPassword, user.passwordHash))) {
    return c.json({ error: 'Your current password is incorrect', code: 'wrong_password' }, 400);
  }
  await db.clearUserSso(user.userId);
  try { await db.createAuditLog({ action: 'sso_unlinked', userId: user.userId, email: user.email, performedBy: user.userId, details: { provider: user.ssoKey.split(':')[0] } }); } catch { /* best-effort */ }
  return c.json({ ok: true });
});

export default sso;
