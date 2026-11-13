/**
 * PUT /v1/admin/invites/:token/email: fix a mistyped address on a pending
 * invite, keep the details, kill the old link.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import auth from '../../src/routes/auth.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const ROLES = { usr_admin: 'admin', usr_edu: 'educator', usr_test: 'tester' };
const now = () => Math.floor(Date.now() / 1000);
let invites, audit;
function app() { const a = new Hono(); a.route('/', admin); a.route('/', auth); return a; }
async function change(token, email, as = 'usr_admin') {
  const t = await signAccessToken(as, ROLES[as]);
  return app().request(`/v1/admin/invites/${token}/email`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ email }) });
}

beforeEach(() => {
  process.env.SKIP_EMAIL = 'true';
  const profile = { firstName: 'Typo', lastName: 'Person', userGroup: 'Cohort A', customFields: { org: 'UIC' } };
  invites = new Map([
    ['inv_typo', { inviteToken: 'inv_typo', status: 'pending', email: 'person@gmial.com', expiresAt: now() - 60, profile }],
    ['inv_acct', { inviteToken: 'inv_acct', status: 'pending', email: 'acct@x.com', forUserId: 'usr_x', expiresAt: now() + 99 }],
    ['inv_other', { inviteToken: 'inv_other', status: 'pending', email: 'taken@x.com', expiresAt: now() + 99 }],
    ['wl_1', { inviteToken: 'wl_1', status: 'waitlist', email: 'waiting@x.com' }],
    ['inv_used', { inviteToken: 'inv_used', status: 'used', email: 'used@x.com' }],
  ]);
  audit = [];
  db.getUserById = async (id) => (ROLES[id] ? { userId: id, role: ROLES[id], name: id } : null);
  db.getSyncData = async () => null;
  db.getInvite = async (t) => invites.get(t) || null;
  db.getInviteByEmail = async (e) => [...invites.values()].find((i) => i.email === e && i.status === 'pending') || null;
  db.getWaitlistEntryByEmail = async (e) => [...invites.values()].find((i) => i.email === e && i.status === 'waitlist') || null;
  db.getUserByEmail = async (e) => (e === 'member@x.com' ? { userId: 'usr_m', email: e } : null);
  db.createInvite = async (i) => { invites.set(i.inviteToken, { ...i, status: 'pending', expiresAt: now() + 7 * 86400 }); };
  db.deleteInvite = async (t) => { invites.delete(t); };
  db.createAuditLog = async (a) => { audit.push(a); };
});
afterEach(() => { delete process.env.SKIP_EMAIL; });

describe('change an invite’s email', () => {
  it('sends a fresh invite to the new address with the same details; the old link is gone', async () => {
    const res = await change('inv_typo', '  Person@Gmail.com ');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, 'person@gmail.com');
    assert.ok(!invites.has('inv_typo'));
    const fresh = invites.get(body.inviteToken);
    assert.equal(fresh.email, 'person@gmail.com');
    assert.deepEqual(fresh.profile, { firstName: 'Typo', lastName: 'Person', userGroup: 'Cohort A', customFields: { org: 'UIC' } });
    assert.ok(fresh.expiresAt > now() + 6 * 86400, 'a fresh 7-day link, even for an expired invite');
    assert.equal((await app().request('/v1/auth/invite/inv_typo')).status, 404, 'old link no longer works');
    assert.equal((await app().request(`/v1/auth/invite/${body.inviteToken}`)).status, 200);
    assert.deepEqual(audit[0].details, { from: 'person@gmial.com', to: 'person@gmail.com' });
  });

  it('refuses addresses already in use, and leaves the invite as it was', async () => {
    for (const [email, status] of [['member@x.com', 409], ['taken@x.com', 409], ['waiting@x.com', 409], ['person@gmial.com', 400], ['not-an-email', 400]]) {
      assert.equal((await change('inv_typo', email)).status, status, email);
    }
    assert.ok(invites.has('inv_typo'));
    assert.equal(audit.length, 0);
  });

  it('refuses account invites, used or unknown invites', async () => {
    assert.equal((await change('inv_acct', 'new@x.com')).status, 400);
    assert.equal((await change('inv_used', 'new@x.com')).status, 404);
    assert.equal((await change('nope', 'new@x.com')).status, 404);
  });

  it('needs invites.write: admins and educators, not testers', async () => {
    assert.equal((await change('inv_typo', 'a1@x.com', 'usr_edu')).status, 200);
    assert.equal((await change('inv_other', 'a2@x.com', 'usr_test')).status, 403);
  });
});
