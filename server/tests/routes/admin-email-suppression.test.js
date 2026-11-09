/**
 * Bounced / complained addresses in the admin API (lib/email-suppression.js).
 * SUPPRESSED_EMAILS stands in for SES's account-level suppression list.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { _resetSuppression } from '../../src/lib/email-suppression.js';

const ROLES = { usr_admin: 'admin', usr_edu: 'educator' };
async function req(as, method, path, body) {
  const app = new Hono();
  app.route('/', admin);
  const token = await signAccessToken(as, ROLES[as]);
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let audit;
let invites;
beforeEach(() => {
  _resetSuppression();
  process.env.SKIP_EMAIL = 'true';
  // bounced@ is a user, spam@ a pending invite, wait@ a wait-list entry;
  // other@ is someone else's address on the shared AWS account.
  process.env.SUPPRESSED_EMAILS = 'bounced@example.com:BOUNCE,spam@example.com:COMPLAINT,wait@example.com,other@elsewhere.com';
  audit = [];
  invites = [
    { inviteToken: 'inv_spam', email: 'spam@example.com', status: 'pending' },
    { inviteToken: 'wl_1', email: 'wait@example.com', status: 'waitlist', profile: {} },
    { inviteToken: 'inv_used', email: 'old@elsewhere.com', status: 'used' },
  ];
  db.getSyncData = async () => null;
  db.getUserById = async (id) => (ROLES[id] ? { userId: id, role: ROLES[id], name: id } : (id === 'usr_b' ? { userId: 'usr_b', email: 'bounced@example.com', role: 'learner' } : null));
  db.listAllUsers = async () => [{ userId: 'usr_b', email: 'Bounced@example.com' }, { userId: 'usr_ok', email: 'ok@example.com' }];
  db.listInvites = async () => invites;
  db.getUserByEmail = async (email) => (email === 'bounced@example.com' ? { userId: 'usr_b', email } : null);
  db.getInviteByEmail = async (email) => invites.find((i) => i.email === email && i.status === 'pending') || null;
  db.getInvite = async (t) => invites.find((i) => i.inviteToken === t) || null;
  db.createInvite = async () => {};
  db.deleteInvite = async () => {};
  db.createAuditLog = async (e) => { audit.push(e); };
  db.putSyncData = async () => ({});
});
afterEach(() => { delete process.env.SKIP_EMAIL; delete process.env.SUPPRESSED_EMAILS; _resetSuppression(); });

describe('sending to a suppressed address', () => {
  it('a single invite is created but reported as not sent', async () => {
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    const res = await req('usr_admin', 'POST', '/v1/admin/invites', { email: 'bounced@example.com' });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.suppressed, true);
    assert.equal(data.reason, 'BOUNCE');
    assert.ok(data.inviteToken);
  });

  it('bulk invites mark it `suppressed` and count it', async () => {
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    const res = await req('usr_admin', 'POST', '/v1/admin/invites/bulk', { emails: ['bounced@example.com', 'fine@example.com'] });
    const data = await res.json();
    assert.equal(data.sent, 1);
    assert.equal(data.suppressed, 1);
    assert.equal(data.results[0].status, 'suppressed');
    assert.equal(data.results[0].reason, 'BOUNCE');
    assert.equal(data.results[1].status, 'sent');
  });

  it('a resend reports it', async () => {
    const res = await req('usr_admin', 'POST', '/v1/admin/invites/resend', { email: 'spam@example.com' });
    const data = await res.json();
    assert.equal(data.suppressed, true);
    assert.equal(data.reason, 'COMPLAINT');
  });

  it('inviting from the wait list reports it', async () => {
    const res = await req('usr_admin', 'POST', '/v1/admin/waitlist/wl_1/invite');
    assert.equal(res.status, 201);
    assert.equal((await res.json()).suppressed, true);
  });

  it('an admin password reset reports it', async () => {
    db.updateUser = async () => {};
    db.storeResetToken = async () => {};
    db.deleteResetToken = async () => {};
    db.getUserById = async (id) => (id === 'usr_b' ? { userId: 'usr_b', email: 'bounced@example.com', role: 'learner' } : { userId: id, role: ROLES[id] });
    const res = await req('usr_admin', 'POST', '/v1/admin/users/usr_b/reset-password');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.suppressed, true);
    assert.equal(data.reason, 'BOUNCE');
  });
});

describe('GET /v1/admin/email-suppression', () => {
  it('lists only plato’s addresses (users, pending invites, wait list)', async () => {
    const res = await req('usr_edu', 'GET', '/v1/admin/email-suppression');
    assert.equal(res.status, 200);
    const { suppressed } = await res.json();
    assert.deepEqual(suppressed.map((s) => [s.email, s.reason]).sort(), [
      ['bounced@example.com', 'BOUNCE'], ['spam@example.com', 'COMPLAINT'], ['wait@example.com', 'BOUNCE'],
    ]);
    assert.ok(!JSON.stringify(suppressed).includes('elsewhere'), 'never another app’s address');
  });
});

describe('DELETE /v1/admin/email-suppression/:email', () => {
  it('needs users.write (an educator can see the list but not change it)', async () => {
    const res = await req('usr_edu', 'DELETE', '/v1/admin/email-suppression/bounced%40example.com');
    assert.equal(res.status, 403);
  });

  it('removes a plato address and writes the audit log', async () => {
    const res = await req('usr_admin', 'DELETE', '/v1/admin/email-suppression/bounced%40example.com');
    assert.equal(res.status, 200);
    assert.deepEqual(audit, [{
      action: 'email_suppression_removed', userId: 'usr_b', email: 'bounced@example.com', performedBy: 'usr_admin', details: { reason: 'BOUNCE' },
    }]);
    const { suppressed } = await (await req('usr_admin', 'GET', '/v1/admin/email-suppression')).json();
    assert.ok(!suppressed.some((s) => s.email === 'bounced@example.com'));
  });

  it('refuses addresses that aren’t plato’s', async () => {
    const res = await req('usr_admin', 'DELETE', '/v1/admin/email-suppression/other%40elsewhere.com');
    assert.equal(res.status, 404);
    assert.equal(audit.length, 0);
  });
});
