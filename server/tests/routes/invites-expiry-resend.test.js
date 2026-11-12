/**
 * Expired invites are kept: the link stops working, the admin list marks them,
 * and Resend (single or bulk) gives a fresh link with the same details.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import auth from '../../src/routes/auth.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const ROLES = { usr_admin: 'admin', usr_test: 'tester' };
const now = () => Math.floor(Date.now() / 1000);
let invites, audit;
function app() { const a = new Hono(); a.route('/', admin); a.route('/', auth); return a; }
async function as(user, method, path, body) {
  const token = await signAccessToken(user, ROLES[user]);
  return app().request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
}

beforeEach(() => {
  process.env.SKIP_EMAIL = 'true';
  invites = new Map([
    ['inv_old', { inviteToken: 'inv_old', status: 'pending', email: 'late@x.com', expiresAt: now() - 3600, profile: { firstName: 'Late', userGroup: 'Cohort A', customFields: { f: 'v' } } }],
    ['inv_legacy', { inviteToken: 'inv_legacy', status: 'pending', email: 'legacy@x.com', ttl: now() - 60 }],
    ['inv_live', { inviteToken: 'inv_live', status: 'pending', email: 'live@x.com', expiresAt: now() + 86400 }],
  ]);
  audit = [];
  db.getUserById = async (id) => (ROLES[id] ? { userId: id, role: ROLES[id], name: id } : null);
  db.getSyncData = async () => null;
  db.listInvites = async () => [...invites.values()];
  db.getInvite = async (t) => invites.get(t) || null;
  db.getInviteByEmail = async (e) => [...invites.values()].filter((i) => i.email === e && i.status === 'pending')[0] || null;
  db.getUserByEmail = async () => null;
  db.deleteInvite = async (t) => { invites.delete(t); };
  db.createInvite = async (i) => { invites.set(i.inviteToken, { ...i, status: 'pending', expiresAt: now() + 7 * 86400 }); };
  db.createAuditLog = async (a) => { audit.push(a); };
});
afterEach(() => { delete process.env.SKIP_EMAIL; });

describe('expired invites', () => {
  it('an expired link is refused at signup (expiresAt or a legacy ttl), a live one works', async () => {
    assert.equal((await app().request('/v1/auth/invite/inv_old')).status, 404);
    assert.equal((await app().request('/v1/auth/invite/inv_legacy')).status, 404);
    assert.equal((await app().request('/v1/auth/invite/inv_live')).status, 200);
    const signup = await app().request('/v1/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken: 'inv_old', firstName: 'L', password: 'long-enough-1' }) });
    assert.equal(signup.status, 400);
  });

  it('the admin list keeps expired invites and marks them', async () => {
    const list = await (await as('usr_admin', 'GET', '/v1/admin/invites')).json();
    const by = Object.fromEntries(list.map((i) => [i.email, i]));
    assert.equal(by['late@x.com'].expired, true);
    assert.equal(by['legacy@x.com'].expired, true);
    assert.equal(by['live@x.com'].expired, false);
    assert.ok(by['live@x.com'].expiresAt);
  });

  it('bulk resend gives each a fresh link with the same details; unknown emails fail; the batch keeps going', async () => {
    const res = await as('usr_admin', 'POST', '/v1/admin/invites/resend-bulk', { emails: ['Late@x.com', 'legacy@x.com', 'nobody@x.com'] });
    assert.equal(res.status, 200);
    const { results } = await res.json();
    const by = Object.fromEntries(results.map((r) => [r.email, r]));
    assert.equal(by['late@x.com'].status, 'sent');
    assert.equal(by['legacy@x.com'].status, 'sent');
    assert.equal(by['nobody@x.com'].status, 'failed');
    assert.ok(!invites.has('inv_old'), 'the expired invite is replaced');
    const fresh = [...invites.values()].find((i) => i.email === 'late@x.com');
    assert.deepEqual(fresh.profile, { firstName: 'Late', userGroup: 'Cohort A', customFields: { f: 'v' } });
    assert.equal(fresh.expiresAt > now() + 6 * 86400, true);
    assert.deepEqual(audit.at(-1).details, { count: 2, failed: 1 });
  });

  it('validates the batch and refuses testers', async () => {
    assert.equal((await as('usr_admin', 'POST', '/v1/admin/invites/resend-bulk', { emails: [] })).status, 400);
    assert.equal((await as('usr_admin', 'POST', '/v1/admin/invites/resend-bulk', { emails: Array.from({ length: 51 }, (_, i) => `e${i}@x.com`) })).status, 400);
    assert.equal((await as('usr_test', 'POST', '/v1/admin/invites/resend-bulk', { emails: ['late@x.com'] })).status, 403);
  });
});
