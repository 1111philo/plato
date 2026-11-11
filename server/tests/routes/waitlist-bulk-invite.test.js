/**
 * POST /v1/admin/waitlist/invite-bulk: invite many wait-list entries at once,
 * with the single invite's rules.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const ROLES = { usr_admin: 'admin', usr_edu: 'educator', usr_test: 'tester', usr_l: 'learner' };
async function bulk(body, as = 'usr_admin') {
  const app = new Hono();
  app.route('/', admin);
  const token = await signAccessToken(as, ROLES[as]);
  return app.request('/v1/admin/waitlist/invite-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

let invites, created, deleted, audit;
beforeEach(() => {
  process.env.SKIP_EMAIL = 'true';
  invites = new Map([
    ['wl_a', { inviteToken: 'wl_a', status: 'waitlist', email: 'a@x.com', profile: { firstName: 'Ann', userGroup: 'Cohort A' } }],
    ['wl_b', { inviteToken: 'wl_b', status: 'waitlist', email: 'b@x.com', profile: {} }],
    ['wl_acct', { inviteToken: 'wl_acct', status: 'waitlist', email: 'has@x.com', profile: {} }],
    ['wl_dup', { inviteToken: 'wl_dup', status: 'waitlist', email: 'dup@x.com', profile: {} }],
    ['inv_dup', { inviteToken: 'inv_dup', status: 'pending', email: 'dup@x.com' }],
  ]);
  created = []; deleted = []; audit = [];
  db.getUserById = async (id) => (ROLES[id] ? { userId: id, role: ROLES[id], name: id } : null);
  db.getSyncData = async () => null;
  db.getInvite = async (t) => invites.get(t) || null;
  db.getInviteByEmail = async (e) => [...invites.values()].find((i) => i.email === e && i.status === 'pending') || null;
  db.getUserByEmail = async (e) => (e === 'has@x.com' ? { userId: 'usr_has', email: e, firstName: 'Has' } : null);
  db.createInvite = async (i) => { created.push(i); invites.set(i.inviteToken, { ...i, status: 'pending' }); };
  db.deleteInvite = async (t) => { deleted.push(t); invites.delete(t); };
  db.createAuditLog = async (a) => { audit.push(a); };
});
afterEach(() => { delete process.env.SKIP_EMAIL; });

describe('bulk invite from the wait list', () => {
  it('invites each entry like the single invite: profile carried, entry removed, accounts get an account invite', async () => {
    const res = await bulk({ tokens: ['wl_a', 'wl_b', 'wl_acct'] });
    assert.equal(res.status, 200);
    const { results } = await res.json();
    assert.deepEqual(results.map((r) => [r.token, r.status]).sort(), [['wl_a', 'invited'], ['wl_acct', 'invited'], ['wl_b', 'invited']]);
    assert.equal(results.find((r) => r.token === 'wl_acct').existingAccount, true);
    assert.deepEqual(created.find((i) => i.email === 'a@x.com').profile, { firstName: 'Ann', userGroup: 'Cohort A' });
    assert.equal(created.find((i) => i.email === 'has@x.com').forUserId, 'usr_has');
    assert.deepEqual(deleted.sort(), ['wl_a', 'wl_acct', 'wl_b']);
    assert.deepEqual(audit[0].details, { count: 3, skipped: 0, failed: 0 });
  });

  it('skips an email with a pending invite, and reports entries that are gone; keeps going', async () => {
    const { results } = await (await bulk({ tokens: ['wl_dup', 'nope', 'wl_b'] })).json();
    const by = Object.fromEntries(results.map((r) => [r.token, r]));
    assert.equal(by.wl_dup.status, 'skipped');
    assert.match(by.wl_dup.error, /pending invite/);
    assert.equal(by.nope.status, 'failed');
    assert.equal(by.wl_b.status, 'invited');
    assert.ok(invites.has('wl_dup'), 'a skipped entry stays on the list');
  });

  it('a send error on one entry is reported and the rest still go', async () => {
    const real = db.createInvite;
    db.createInvite = async (i) => { if (i.email === 'a@x.com') throw new Error('db down'); return real(i); };
    const { results } = await (await bulk({ tokens: ['wl_a', 'wl_b'] })).json();
    assert.deepEqual(results.map((r) => [r.token, r.status]).sort(), [['wl_a', 'failed'], ['wl_b', 'invited']]);
  });

  it('validates the request, and the batch size', async () => {
    assert.equal((await bulk({ tokens: [] })).status, 400);
    assert.equal((await bulk({})).status, 400);
    assert.equal((await bulk({ tokens: Array.from({ length: 51 }, (_, i) => `t${i}`) })).status, 400);
  });

  it('educators can invite (waitlist.invite); testers and learners can’t', async () => {
    assert.equal((await bulk({ tokens: ['wl_a'] }, 'usr_edu')).status, 200);
    assert.equal((await bulk({ tokens: ['wl_b'] }, 'usr_test')).status, 403);
    assert.equal((await bulk({ tokens: ['wl_b'] }, 'usr_l')).status, 403);
  });
});
