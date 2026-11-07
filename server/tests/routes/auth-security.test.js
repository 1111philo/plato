/**
 * Sign-in security from the #451 scale review: reset tokens can't refresh
 * (S1), password/email changes need the current password and end other
 * sessions (S2), refresh rotation has a short grace (H1), and the public auth
 * endpoints are rate-limited with a per-account lock (S3). In-memory db.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import auth, { _resetAuthLimits } from '../../src/routes/auth.js';
import me from '../../src/routes/me.js';
import db from '../../src/lib/db.js';
import { hashToken } from '../../src/lib/crypto.js';
import { hashPassword } from '../../src/lib/password.js';
import { signAccessToken, verifyAccessToken } from '../../src/lib/jwt.js';
import { REFRESH_GRACE_SECONDS, LOGIN_MAX_FAILURES, exchangeRefreshToken } from '../../src/lib/sessions.js';

let users, tokens;
const PASSWORD = 'correct-horse';
let PASSWORD_HASH;

function app() {
  const a = new Hono();
  a.route('/', auth);
  a.route('/', me);
  return a;
}
const post = (path, body, headers = {}) => app().request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const patchMe = (token, body) => app().request('/v1/me', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
});

beforeEach(async () => {
  _resetAuthLimits();
  PASSWORD_HASH ||= await hashPassword(PASSWORD);
  users = { usr_ada: { userId: 'usr_ada', email: 'ada@example.com', username: 'ada', role: 'learner', passwordHash: PASSWORD_HASH } };
  tokens = new Map();
  const nowSec = () => Math.floor(Date.now() / 1000);
  db.getUserById = async (id) => (users[id] ? { ...users[id] } : null);
  db.getUserByEmail = async (e) => Object.values(users).find((u) => u.email === e.toLowerCase()) || null;
  db.getUserByUsername = async (n) => Object.values(users).find((u) => u.username === n.toLowerCase()) || null;
  db.updateUser = async (id, u) => { users[id] = { ...users[id], ...u }; };
  db.storeRefreshToken = async (h, userId, { tokenVersion = 0 } = {}) => { tokens.set(h, { tokenHash: h, userId, tokenVersion, ttl: nowSec() + 86400 }); };
  db.getRefreshToken = async (h) => { const t = tokens.get(h); return t && t.type !== 'reset' && !(t.ttl < nowSec()) ? { ...t } : null; };
  db.markRefreshTokenRotated = async (h, grace) => { const t = tokens.get(h); if (t) { t.rotatedAt ||= new Date().toISOString(); t.ttl = nowSec() + grace; } };
  db.deleteRefreshToken = async (h) => { tokens.delete(h); };
  db.storeResetToken = async (h, userId) => { tokens.set(h, { tokenHash: h, userId, type: 'reset', ttl: nowSec() + 3600 }); };
  db.getResetToken = async (h) => { const t = tokens.get(h); return t && t.type === 'reset' && !(t.ttl < nowSec()) ? { ...t } : null; };
  db.deleteResetToken = async (h) => { tokens.delete(h); };
  db.createAuditLog = async () => {};
  db.setUserActivityField = async () => {};
  db.getSyncData = async () => null;
});

async function signIn() {
  const res = await post('/v1/auth/login', { email: 'ada@example.com', password: PASSWORD });
  assert.equal(res.status, 200);
  return res.json();
}

describe('S1: a reset token is not a session', () => {
  it('refresh refuses a reset token, and an expired refresh token', async () => {
    tokens.set(hashToken('rt_reset'), { tokenHash: hashToken('rt_reset'), userId: 'usr_ada', type: 'reset', ttl: Math.floor(Date.now() / 1000) + 3600 });
    assert.equal((await post('/v1/auth/refresh', { refreshToken: 'rt_reset' })).status, 401);
    tokens.set(hashToken('rt_old'), { tokenHash: hashToken('rt_old'), userId: 'usr_ada', ttl: Math.floor(Date.now() / 1000) - 5 });
    assert.equal((await post('/v1/auth/refresh', { refreshToken: 'rt_old' })).status, 401);
  });
});

describe('S2: changing the password or email', () => {
  it('needs the current password', async () => {
    const { accessToken } = await signIn();
    assert.equal((await patchMe(accessToken, { password: 'a-new-password' })).status, 403);
    assert.equal((await patchMe(accessToken, { password: 'a-new-password', currentPassword: 'wrong' })).status, 403);
    assert.equal((await patchMe(accessToken, { email: 'eve@example.com' })).status, 403);
    assert.equal(users.usr_ada.passwordHash, PASSWORD_HASH);
    assert.equal(users.usr_ada.email, 'ada@example.com');
  });

  it('validates the email; the same email needs no password', async () => {
    const { accessToken } = await signIn();
    assert.equal((await patchMe(accessToken, { email: 'not-an-email', currentPassword: PASSWORD })).status, 400);
    assert.equal((await patchMe(accessToken, { email: 'ADA@example.com', username: 'ada2' })).status, 200);
  });

  it('ends every other session and gives this device a fresh one', async () => {
    const other = await signIn(); // another device
    const mine = await signIn();
    const res = await patchMe(mine.accessToken, { password: 'a-new-password', currentPassword: PASSWORD });
    assert.equal(res.status, 200);
    const { session } = await res.json();
    assert.ok(session?.accessToken && session?.refreshToken);
    assert.equal(users.usr_ada.tokenVersion, 1);
    assert.equal((await verifyAccessToken(session.accessToken)).tv, 1);
    // The other device's access and refresh tokens no longer work; the new ones do.
    const meWith = (t) => app().request('/v1/me', { headers: { Authorization: 'Bearer ' + t } });
    assert.equal((await meWith(other.accessToken)).status, 401);
    assert.equal((await post('/v1/auth/refresh', { refreshToken: other.refreshToken })).status, 401);
    assert.equal((await meWith(session.accessToken)).status, 200);
    assert.equal((await post('/v1/auth/refresh', { refreshToken: session.refreshToken })).status, 200);
  });

  it('tokens from before session versions (no tv, no tokenVersion) still work', async () => {
    const legacy = await signAccessToken('usr_ada', 'learner'); // tv 0
    const res = await app().request('/v1/me', { headers: { Authorization: 'Bearer ' + legacy } });
    assert.equal(res.status, 200);
  });
});

describe('H1: refresh rotation has a short grace', () => {
  it('parallel refreshes with one token all succeed; after the grace it is refused', async () => {
    const { refreshToken } = await signIn();
    const results = await Promise.all([1, 2, 3].map(() => post('/v1/auth/refresh', { refreshToken })));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
    const later = Date.now() + (REFRESH_GRACE_SECONDS + 1) * 1000;
    assert.deepEqual(await exchangeRefreshToken(refreshToken, { now: later }), { error: 'Invalid refresh token' });
  });
});

describe('S3: limits on sign-in and password reset', () => {
  it('locks an account after repeated wrong passwords; a correct one then waits too', async () => {
    for (let i = 1; i < LOGIN_MAX_FAILURES; i++) {
      assert.equal((await post('/v1/auth/login', { email: 'ada', password: 'nope' })).status, 401);
    }
    const locked = await post('/v1/auth/login', { email: 'ada', password: 'nope' });
    assert.equal(locked.status, 429);
    assert.match((await locked.json()).error, /Too many sign-in attempts/);
    assert.equal((await post('/v1/auth/login', { email: 'ada', password: PASSWORD })).status, 429);
  });

  it('a correct password resets the count', async () => {
    for (let i = 1; i < LOGIN_MAX_FAILURES; i++) await post('/v1/auth/login', { email: 'ada', password: 'nope' });
    await signIn();
    assert.equal(users.usr_ada.failedLogins, 0);
    assert.equal((await post('/v1/auth/login', { email: 'ada', password: 'nope' })).status, 401);
  });

  it('unknown names get the same lock message, so it doesn’t reveal accounts', async () => {
    let last;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) last = await post('/v1/auth/login', { email: 'ghost', password: 'nope' });
    assert.equal(last.status, 429);
  });

  it('limits sign-ins per address', async () => {
    const from = { 'X-Forwarded-For': '203.0.113.9' };
    let last;
    for (let i = 0; i < 31; i++) last = await post('/v1/auth/login', { email: `x${i}`, password: 'nope' }, from);
    assert.equal(last.status, 429);
    assert.equal((await post('/v1/auth/login', { email: 'ada', password: PASSWORD }, { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
  });

  it('forgot-password: one email per cooldown, and only the newest link works', async () => {
    const emailModule = await import('../../src/lib/email.js');
    assert.ok(emailModule.sendResetEmail);
    process.env.SKIP_EMAIL = 'true';
    try {
      assert.equal((await post('/v1/auth/forgot-password', { email: 'ada@example.com' })).status, 200);
      const firstHash = users.usr_ada.resetTokenHash;
      assert.ok(firstHash);
      assert.equal((await post('/v1/auth/forgot-password', { email: 'ada@example.com' })).status, 200);
      assert.equal(users.usr_ada.resetTokenHash, firstHash, 'no second link inside the cooldown');
      // Past the cooldown, a new link replaces the old one.
      users.usr_ada.resetRequestedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      await post('/v1/auth/forgot-password', { email: 'ada@example.com' });
      assert.notEqual(users.usr_ada.resetTokenHash, firstHash);
      assert.equal(tokens.has(firstHash), false, 'the older link is gone');
      // Unknown emails get the same answer.
      assert.equal((await post('/v1/auth/forgot-password', { email: 'nobody@example.com' })).status, 200);
    } finally {
      delete process.env.SKIP_EMAIL;
    }
  });

  it('resetting the password ends every session and clears the lock', async () => {
    const before = await signIn();
    users.usr_ada.lockedUntil = new Date(Date.now() + 60_000).toISOString();
    tokens.set(hashToken('reset_1'), { tokenHash: hashToken('reset_1'), userId: 'usr_ada', type: 'reset', ttl: Math.floor(Date.now() / 1000) + 3600 });
    users.usr_ada.resetTokenHash = hashToken('reset_1');
    assert.equal((await post('/v1/auth/reset-password', { resetToken: 'reset_1', password: 'brand-new-pass' })).status, 200);
    assert.equal(users.usr_ada.tokenVersion, 1);
    assert.equal(users.usr_ada.lockedUntil, null);
    assert.equal((await post('/v1/auth/refresh', { refreshToken: before.refreshToken })).status, 401);
    assert.equal((await post('/v1/auth/login', { email: 'ada', password: 'brand-new-pass' })).status, 200);
    assert.equal((await post('/v1/auth/reset-password', { resetToken: 'reset_1', password: 'again-again' })).status, 400, 'used once');
  });

  it('an older reset link is refused once a newer one exists', async () => {
    tokens.set(hashToken('reset_old'), { tokenHash: hashToken('reset_old'), userId: 'usr_ada', type: 'reset', ttl: Math.floor(Date.now() / 1000) + 3600 });
    users.usr_ada.resetTokenHash = hashToken('reset_newer');
    assert.equal((await post('/v1/auth/reset-password', { resetToken: 'reset_old', password: 'brand-new-pass' })).status, 400);
  });
});

describe('malformed bodies', () => {
  it('public auth endpoints answer 400, not 500', async () => {
    for (const path of ['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/forgot-password', '/v1/auth/reset-password', '/v1/auth/signup']) {
      assert.equal((await post(path, '{not json')).status, 400, path);
    }
  });
});
