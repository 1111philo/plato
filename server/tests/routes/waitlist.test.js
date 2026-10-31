/**
 * Wait list (#363): the public join form, the admin routes, and signup
 * filling in a wait-list invite's answers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import waitlist, { _resetJoinLimit, JOIN_LIMIT } from '../../src/routes/waitlist.js';
import admin from '../../src/routes/admin.js';
import auth from '../../src/routes/auth.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { hashToken } from '../../src/lib/crypto.js';
import { setEmailTransport } from '../../src/lib/notifications.js';
import unsubscribe from '../../src/routes/unsubscribe.js';
import { unsubscribeToken } from '../../src/lib/notifications.js';

const FIELDS = [
  { id: 'fld_org', label: 'Organization', type: 'text', required: true },
  { id: 'fld_role', label: 'Role', type: 'dropdown', required: false, options: ['Staff', 'Student'] },
];
const SETTINGS = { userGroups: ['Cohort A'], userFields: FIELDS };
const VALID = { name: 'Ada', email: 'Ada@Example.com', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } };

let store; // sync-data records by dataKey
let created; // createWaitlistEntry calls

function makeApp() {
  const app = new Hono();
  app.route('/', waitlist);
  app.route('/', admin);
  app.route('/', auth);
  return app;
}

function post(app, path, body, headers = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function adminReq(app, method, path, body) {
  const token = await signAccessToken('usr_admin', 'admin');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  _resetJoinLimit();
  // Fresh copy each test — admin routes mutate settings in place.
  store = { settings: structuredClone(SETTINGS), waitlist: { open: true, apiKeyHash: null } };
  created = [];
  db.getSyncData = async (_u, key) => (key in store ? { data: store[key], version: 1 } : null);
  db.putSyncData = async (_u, key, data) => { store[key] = data; };
  db.getUserByEmail = async () => null;
  db.getUserByUsername = async () => null;
  db.getInviteByEmail = async () => null;
  db.listAllUsers = async () => [];
  db.getWaitlistEntryByEmail = async () => null;
  db.createWaitlistEntry = async (entry) => { created.push(entry); };
  db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  db.createAuditLog = async () => {};
});

// #388: the confirmation email, sent once, never failing the join.
describe('wait list confirmation email (#388)', () => {
  let mails;
  beforeEach(() => { mails = []; setEmailTransport(async (raw) => { mails.push(raw); }); });
  const subjectOf = (raw) => raw.match(/^Subject: (.*)$/m)[1];

  it('is off by default', async () => {
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    assert.equal(mails.length, 0);
  });

  it('sends once when on, to the new entry only', async () => {
    store.automations = { waitlistConfirmation: true };
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    assert.equal(mails.length, 1);
    assert.match(mails[0], /^To: ada@example\.com$/m);
    assert.equal(subjectOf(mails[0]), "You're on the wait list for plato");
    // A retry finds the entry: same reply, no second email.
    db.getWaitlistEntryByEmail = async () => ({ inviteToken: 'inv_wl_x', status: 'waitlist' });
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    assert.equal(mails.length, 1);
  });

  it('a concurrent duplicate that loses the create-only write sends nothing', async () => {
    store.automations = { waitlistConfirmation: true };
    db.createWaitlistEntry = async () => { throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }); };
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    assert.equal(mails.length, 0);
  });

  it('is not sent to someone who already has an account or an invite (stored all the same)', async () => {
    store.automations = { waitlistConfirmation: true };
    db.getUserByEmail = async () => ({ userId: 'usr_ada' });
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => ({ inviteToken: 'inv_p', status: 'pending' });
    assert.equal((await post(makeApp(), '/v1/waitlist', { ...VALID, email: 'b@example.com' })).status, 202);
    assert.equal(created.length, 2);
    assert.equal(mails.length, 0);
  });

  it('uses the admin’s edited copy', async () => {
    store.automations = { waitlistConfirmation: true };
    store['emailTemplate:waitlist-confirmation'] = { subject: 'Welcome aboard, {{firstName}}', body: 'Hi {{firstName}}' };
    await post(makeApp(), '/v1/waitlist', VALID);
    assert.equal(subjectOf(mails[0]), 'Welcome aboard, Ada');
  });

  it('a send failure is logged and the join still succeeds', async () => {
    store.automations = { waitlistConfirmation: true };
    setEmailTransport(async () => { throw new Error('SES down'); });
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    assert.equal(created.length, 1);
  });
});

describe('unsubscribe (#400)', () => {
  const app = () => { const a = new Hono(); a.route('/', unsubscribe); return a; };
  it('GET asks to confirm (no change); POST unsubscribes; a bad token changes nothing', async () => {
    const writes = [];
    db.putSyncData = async (u, key, data) => { writes.push({ u, key, data }); };
    const token = unsubscribeToken('usr_ada', 'digest');
    const get = await app().request(`/v1/unsubscribe?token=${token}`);
    assert.equal(get.status, 200);
    assert.match(await get.text(), /Unsubscribe from the weekly digest\?/);
    assert.equal(writes.length, 0, 'GET never unsubscribes (link scanners)');
    const res = await app().request(`/v1/unsubscribe?token=${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /You’re unsubscribed/);
    assert.deepEqual(writes.map((w) => [w.u, w.key, w.data.optOut]), [['usr_ada', 'notify:state', { digest: true }]]);
    assert.equal((await app().request('/v1/unsubscribe?token=bad.token', { method: 'POST' })).status, 400);
    assert.equal(writes.length, 1);
  });
});

describe('join rate limit (#451 review M11)', () => {
  it('limits unkeyed joins per IP; other IPs and keyed requests are unaffected', async () => {
    const from = (ip, extra = {}) => post(makeApp(), '/v1/waitlist', { ...VALID, email: `p${Math.random()}@x.com` }, { 'X-Forwarded-For': ip, ...extra });
    for (let i = 0; i < JOIN_LIMIT; i++) assert.equal((await from('1.2.3.4')).status, 202);
    assert.equal((await from('1.2.3.4')).status, 429);
    assert.equal((await from('5.6.7.8')).status, 202);
  });

  it('keys on the address CloudFront appended, not the one the sender wrote (second review N3)', async () => {
    const env = { requestContext: { http: { sourceIp: '130.176.0.1' } } }; // CloudFront's address
    const from = (xff) => makeApp().request('/v1/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(xff ? { 'X-Forwarded-For': xff } : {}) },
      body: JSON.stringify({ ...VALID, email: `p${Math.random()}@x.com` }),
    }, env);
    // A fresh spoofed first entry each time, the same real viewer after it.
    for (let i = 0; i < JOIN_LIMIT; i++) assert.equal((await from(`10.0.0.${i}, 9.9.9.9`)).status, 202);
    assert.equal((await from('10.0.0.99, 9.9.9.9')).status, 429);
    // The Function URL appending CloudFront's address doesn't change who it is.
    assert.equal((await from('10.0.0.98, 9.9.9.9, 130.176.0.1')).status, 429);
    // No header: the source address is the key, not "no limit".
    _resetJoinLimit();
    for (let i = 0; i < JOIN_LIMIT; i++) assert.equal((await from('')).status, 202);
    assert.equal((await from('')).status, 429);
  });
});

describe('GET /v1/waitlist', () => {
  it('says whether the list is open', async () => {
    const res = await makeApp().request('/v1/waitlist');
    assert.deepEqual(await res.json(), { open: true });
    store.waitlist.open = false;
    assert.deepEqual(await (await makeApp().request('/v1/waitlist')).json(), { open: false });
  });

  it('is closed when nothing is configured', async () => {
    delete store.waitlist;
    assert.deepEqual(await (await makeApp().request('/v1/waitlist')).json(), { open: false });
  });
});

describe('POST /v1/waitlist', () => {
  it('adds an entry with name, group, and fields', async () => {
    const res = await post(makeApp(), '/v1/waitlist', VALID);
    assert.equal(res.status, 202);
    assert.equal(created.length, 1);
    assert.equal(created[0].email, 'ada@example.com');
    assert.ok(created[0].inviteToken.startsWith('inv_'));
    // A lone `name` (the public API's original field) is split, marked 'auto' (#402).
    assert.deepEqual(created[0].profile, {
      firstName: 'Ada', lastName: '', name: 'Ada', nameSource: 'auto', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' },
    });
  });

  it('accepts firstName / lastName (#402)', async () => {
    const res = await post(makeApp(), '/v1/waitlist', { ...VALID, name: undefined, firstName: ' Mary ', lastName: 'Ann  Evans' });
    assert.equal(res.status, 202);
    assert.deepEqual(
      [created[0].profile.firstName, created[0].profile.lastName, created[0].profile.name, created[0].profile.nameSource],
      ['Mary', 'Ann Evans', 'Mary Ann Evans', 'user'],
    );
  });

  it('requires a first name', async () => {
    const res = await post(makeApp(), '/v1/waitlist', { ...VALID, name: undefined, firstName: '  ', lastName: 'Evans' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /first name is required/i);
    assert.equal(created.length, 0);
  });

  it('refuses when closed and no key is given', async () => {
    store.waitlist.open = false;
    const res = await post(makeApp(), '/v1/waitlist', VALID);
    assert.equal(res.status, 403);
    assert.equal(created.length, 0);
  });

  it('accepts the API key even when closed', async () => {
    store.waitlist = { open: false, apiKeyHash: hashToken('wlk_test') };
    const res = await post(makeApp(), '/v1/waitlist', VALID, { Authorization: 'Bearer wlk_test' });
    assert.equal(res.status, 202);
    assert.equal(created.length, 1);
  });

  it('drops a public submission that fills the honeypot, with the normal reply', async () => {
    const res = await post(makeApp(), '/v1/waitlist', { ...VALID, website: 'http://spam.example' });
    assert.equal(res.status, 202);
    assert.equal(created.length, 0);
  });

  it('ignores the honeypot for keyed requests', async () => {
    store.waitlist = { open: false, apiKeyHash: hashToken('wlk_test') };
    const res = await post(makeApp(), '/v1/waitlist', { ...VALID, website: 'https://ada.dev' }, { Authorization: 'Bearer wlk_test' });
    assert.equal(res.status, 202);
    assert.equal(created.length, 1);
  });

  it('refuses a wrong API key', async () => {
    store.waitlist = { open: false, apiKeyHash: hashToken('wlk_test') };
    const res = await post(makeApp(), '/v1/waitlist', VALID, { Authorization: 'Bearer wlk_other' });
    assert.equal(res.status, 403);
  });

  it('requires every required custom field', async () => {
    const res = await post(makeApp(), '/v1/waitlist', { ...VALID, customFields: {} });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Organization/);
  });

  it('refuses a group that does not exist', async () => {
    const res = await post(makeApp(), '/v1/waitlist', { ...VALID, userGroup: 'Nope' });
    assert.equal(res.status, 400);
  });

  it('refuses a missing name or a bad email', async () => {
    assert.equal((await post(makeApp(), '/v1/waitlist', { ...VALID, name: ' ' })).status, 400);
    assert.equal((await post(makeApp(), '/v1/waitlist', { ...VALID, email: 'nope' })).status, 400);
    assert.equal(created.length, 0);
  });

  it('keeps the submission of someone who already has an account or invite, with the same reply', async () => {
    db.getUserByEmail = async () => ({ userId: 'usr_1' });
    db.getInviteByEmail = async () => ({ inviteToken: 'inv_p', status: 'pending' });
    const res = await post(makeApp(), '/v1/waitlist', VALID);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(created.length, 1, 'stored so admins can see what they sent');
  });

  it('a repeat join for an email already on the wait list stores nothing', async () => {
    db.getWaitlistEntryByEmail = async () => ({ inviteToken: 'inv_wl', status: 'waitlist' });
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID)).status, 202);
    assert.equal(created.length, 0);
  });

  it('derives the entry key from the email, so the same address always maps to one entry', async () => {
    await post(makeApp(), '/v1/waitlist', VALID);
    await post(makeApp(), '/v1/waitlist', { ...VALID, email: '  ADA@example.com ' });
    assert.equal(created.length, 2);
    assert.equal(created[0].inviteToken, created[1].inviteToken);
    assert.match(created[0].inviteToken, /^inv_wl_[A-Za-z0-9_-]{32}$/);
  });

  it('a concurrent join that loses the create-only write still gets 202', async () => {
    db.createWaitlistEntry = async () => { const e = new Error('exists'); e.name = 'ConditionalCheckFailedException'; throw e; };
    const res = await post(makeApp(), '/v1/waitlist', VALID);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

describe('admin wait-list routes', () => {
  const entry = {
    inviteToken: 'inv_wl1', email: 'ada@example.com', status: 'waitlist', createdAt: '2026-10-01',
    profile: { name: 'Ada', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } },
  };

  it('lists entries only, with open and key state', async () => {
    db.listInvites = async () => [entry, { inviteToken: 'inv_p', email: 'b@x.com', status: 'pending' }];
    store.waitlist.apiKeyHash = 'h';
    const data = await (await adminReq(makeApp(), 'GET', '/v1/admin/waitlist')).json();
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].name, 'Ada');
    assert.deepEqual(data.entries[0].customFields, { fld_org: 'UIC' });
    assert.equal(data.open, true);
    assert.equal(data.hasApiKey, true);
    assert.equal(JSON.stringify(data).includes('"h"'), false, 'the key hash is never returned');
  });

  it('marks entries whose email already has an account or a pending invite', async () => {
    const e = { inviteToken: 'inv_wl1', email: 'ada@example.com', status: 'waitlist', createdAt: '2026-10-01', profile: { name: 'Ada' } };
    db.listInvites = async () => [e, { ...e, inviteToken: 'inv_wl2', email: 'Bo@X.com' }, { ...e, inviteToken: 'inv_wl3', email: 'cy@x.com' }, { inviteToken: 'inv_p', email: 'cy@x.com', status: 'pending' }];
    db.listAllUsers = async () => [{ userId: 'usr_bo', email: 'bo@x.com' }];
    const data = await (await adminReq(makeApp(), 'GET', '/v1/admin/waitlist')).json();
    assert.deepEqual(data.entries.map((x) => [x.email, x.alreadyRegistered]), [['ada@example.com', null], ['Bo@X.com', 'account'], ['cy@x.com', 'invite']]);
  });

  it('hides answers to fields that no longer exist', async () => {
    db.listInvites = async () => [{ ...entry, profile: { ...entry.profile, customFields: { fld_org: 'UIC', fld_gone: 'x' } } }];
    const data = await (await adminReq(makeApp(), 'GET', '/v1/admin/waitlist')).json();
    assert.deepEqual(data.entries[0].customFields, { fld_org: 'UIC' });
  });

  it('deleting a custom field erases its answers from wait-list entries and invites', async () => {
    const profiles = {};
    db.listAllUsers = async () => [];
    db.listInvites = async () => [
      entry,
      { inviteToken: 'inv_p', email: 'b@x.com', status: 'pending', profile: { name: 'B', customFields: { fld_org: 'MIT', fld_role: 'Staff' } } },
      { inviteToken: 'inv_plain', email: 'c@x.com', status: 'pending' },
    ];
    db.setInviteProfile = async (token, profile) => { profiles[token] = profile; };
    const res = await adminReq(makeApp(), 'DELETE', '/v1/admin/user-fields/fld_org');
    assert.equal(res.status, 200);
    assert.deepEqual(profiles, {
      inv_wl1: { name: 'Ada', userGroup: 'Cohort A', customFields: {} },
      inv_p: { name: 'B', customFields: { fld_role: 'Staff' } },
    });
  });

  it('is admin-only', async () => {
    const token = await signAccessToken('usr_user', 'user');
    db.getUserById = async () => ({ userId: 'usr_user', role: 'user' });
    const res = await makeApp().request('/v1/admin/waitlist', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(res.status, 403);
  });

  it('opens and closes the list', async () => {
    const res = await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/settings', { open: false });
    assert.equal(res.status, 200);
    assert.equal(store.waitlist.open, false);
    assert.equal((await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/settings', { open: 'yes' })).status, 400);
  });

  it('makes a key that works once stored, and revokes it', async () => {
    const res = await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/key');
    assert.equal(res.status, 201);
    const { apiKey } = await res.json();
    assert.ok(apiKey.startsWith('wlk_'));
    assert.equal(store.waitlist.apiKeyHash, hashToken(apiKey));
    store.waitlist.open = false;
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID, { Authorization: `Bearer ${apiKey}` })).status, 202);

    await adminReq(makeApp(), 'DELETE', '/v1/admin/waitlist/key');
    assert.equal(store.waitlist.apiKeyHash, null);
    assert.equal((await post(makeApp(), '/v1/waitlist', VALID, { Authorization: `Bearer ${apiKey}` })).status, 403);
  });

  it('invites an entry: a pending invite with its profile, then the entry is gone', async () => {
    process.env.SKIP_EMAIL = 'true';
    const invites = [];
    const deleted = [];
    db.getInvite = async (t) => (t === 'inv_wl1' ? entry : null);
    db.createInvite = async (inv) => { invites.push(inv); };
    db.deleteInvite = async (t) => { deleted.push(t); };
    const res = await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/inv_wl1/invite');
    delete process.env.SKIP_EMAIL;
    assert.equal(res.status, 201);
    assert.equal(invites.length, 1);
    assert.equal(invites[0].email, 'ada@example.com');
    assert.deepEqual(invites[0].profile, entry.profile);
    assert.deepEqual(deleted, ['inv_wl1']);
  });

  it('inviting an entry whose email has an account ties the invite to it (no signup link)', async () => {
    process.env.SKIP_EMAIL = 'true';
    const invites = [];
    const deleted = [];
    db.getInvite = async (t) => (t === 'inv_wl1' ? entry : null);
    db.getUserByEmail = async () => ({ userId: 'usr_ada', email: 'ada@example.com' });
    db.createInvite = async (inv) => { invites.push(inv); };
    db.deleteInvite = async (t) => { deleted.push(t); };
    const res = await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/inv_wl1/invite');
    delete process.env.SKIP_EMAIL;
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.existingAccount, true);
    assert.equal(data.signupUrl, undefined, 'an account gets no signup link');
    assert.equal(invites[0].forUserId, 'usr_ada');
    assert.deepEqual(invites[0].profile, entry.profile);
    assert.deepEqual(deleted, ['inv_wl1']);
  });

  it('resending an account invite keeps it tied to the account', async () => {
    process.env.SKIP_EMAIL = 'true';
    const invites = [];
    db.getInviteByEmail = async () => ({ inviteToken: 'inv_old', email: 'ada@example.com', status: 'pending', profile: entry.profile, forUserId: 'usr_ada' });
    db.createInvite = async (inv) => { invites.push(inv); };
    db.deleteInvite = async () => {};
    const res = await adminReq(makeApp(), 'POST', '/v1/admin/invites/resend', { email: 'ada@example.com' });
    delete process.env.SKIP_EMAIL;
    assert.equal(res.status, 201);
    assert.equal((await res.json()).signupUrl, undefined);
    assert.equal(invites[0].forUserId, 'usr_ada');
  });

  it('an account invite can’t be used to sign up', async () => {
    const inv = { inviteToken: 'inv_acct', email: 'ada@example.com', status: 'pending', forUserId: 'usr_ada', profile: entry.profile };
    db.getInvite = async () => inv;
    assert.equal((await makeApp().request('/v1/auth/invite/inv_acct')).status, 404);
    const res = await post(makeApp(), '/v1/auth/signup', { inviteToken: 'inv_acct', firstName: 'Ada', username: 'ada', password: 'longenough123' });
    assert.equal(res.status, 400);
  });

  it('will not invite a pending invite or an unknown token', async () => {
    db.getInvite = async (t) => (t === 'inv_p' ? { inviteToken: 'inv_p', status: 'pending', email: 'b@x.com' } : null);
    assert.equal((await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/inv_p/invite')).status, 404);
    assert.equal((await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/inv_none/invite')).status, 404);
    assert.equal((await adminReq(makeApp(), 'DELETE', '/v1/admin/waitlist/inv_p')).status, 404);
  });

  it('edits an entry', async () => {
    let updated;
    db.getInvite = async () => entry;
    db.updateWaitlistEntry = async (token, patch) => { updated = { token, ...patch }; };
    const res = await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', {
      firstName: ' Ada ', lastName: 'L.', email: 'ADA.L@example.com', userGroup: 'Cohort A', customFields: { fld_org: 'MIT', fld_role: 'Staff' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(updated, {
      token: 'inv_wl1', email: 'ada.l@example.com',
      profile: {
        firstName: 'Ada', lastName: 'L.', name: 'Ada L.', nameSource: 'user',
        userGroup: 'Cohort A', customFields: { fld_org: 'MIT', fld_role: 'Staff' },
      },
    });
    const data = await res.json();
    assert.equal(data.email, 'ada.l@example.com');
    assert.deepEqual([data.name, data.firstName, data.lastName], ['Ada L.', 'Ada', 'L.']);
  });

  it('edit validates like joining', async () => {
    db.getInvite = async () => entry;
    db.updateWaitlistEntry = async () => { throw new Error('should not write'); };
    const missing = await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', { name: 'Ada', email: 'ada@example.com', customFields: {} });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'Organization is required');
    const badEmail = await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', { name: 'Ada', email: 'nope', customFields: { fld_org: 'UIC' } });
    assert.equal(badEmail.status, 400);
  });

  it('edit refuses an email that belongs to someone else', async () => {
    db.getInvite = async () => entry;
    db.updateWaitlistEntry = async () => { throw new Error('should not write'); };
    const body = { name: 'Ada', email: 'taken@example.com', customFields: { fld_org: 'UIC' } };
    db.getUserByEmail = async () => ({ userId: 'usr_x' });
    assert.equal((await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', body)).status, 409);
    db.getUserByEmail = async () => null;
    db.getWaitlistEntryByEmail = async () => ({ inviteToken: 'inv_other' });
    assert.equal((await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', body)).status, 409);
  });

  it('edit keeps its own email without a conflict', async () => {
    db.getInvite = async () => entry;
    db.getWaitlistEntryByEmail = async () => entry;
    db.updateWaitlistEntry = async () => {};
    const res = await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', { name: 'Ada', email: 'ada@example.com', customFields: { fld_org: 'UIC' } });
    assert.equal(res.status, 200);
  });

  it('edit 404s for a pending invite, an unknown token, or a lost race', async () => {
    db.getInvite = async () => ({ ...entry, status: 'pending' });
    assert.equal((await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', { name: 'A', email: 'a@x.com', customFields: { fld_org: 'U' } })).status, 404);
    db.getInvite = async () => entry;
    db.updateWaitlistEntry = async () => { const e = new Error('gone'); e.name = 'ConditionalCheckFailedException'; throw e; };
    assert.equal((await adminReq(makeApp(), 'PUT', '/v1/admin/waitlist/inv_wl1', { name: 'A', email: 'ada@example.com', customFields: { fld_org: 'U' } })).status, 404);
  });

  it('removes an entry', async () => {
    const deleted = [];
    db.getInvite = async () => entry;
    db.deleteInvite = async (t) => { deleted.push(t); };
    assert.equal((await adminReq(makeApp(), 'DELETE', '/v1/admin/waitlist/inv_wl1')).status, 200);
    assert.deepEqual(deleted, ['inv_wl1']);
  });
});

describe('signup from a wait-list invite', () => {
  const invite = {
    inviteToken: 'inv_x', email: 'ada@example.com', status: 'pending',
    ttl: Math.floor(Date.now() / 1000) + 86400,
    profile: { name: 'Ada', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } },
  };

  beforeEach(() => {
    db.getInvite = async (t) => (t === 'inv_x' ? invite : null);
    db.markInviteUsed = async () => {};
    db.storeRefreshToken = async () => {};
  });

  it('GET /v1/auth/invite/:token returns the answers to fill in', async () => {
    const res = await makeApp().request('/v1/auth/invite/inv_x');
    // This entry predates #402 (profile.name only): split on read.
    assert.deepEqual(await res.json(), {
      email: 'ada@example.com', name: 'Ada', firstName: 'Ada', lastName: '', nameSource: 'auto',
      userGroup: 'Cohort A', customFields: { fld_org: 'UIC' },
    });
    assert.equal((await makeApp().request('/v1/auth/invite/inv_none')).status, 404);
  });

  it('GET /v1/auth/invite/:token refuses a wait-list entry', async () => {
    db.getInvite = async () => ({ ...invite, status: 'waitlist' });
    assert.equal((await makeApp().request('/v1/auth/invite/inv_x')).status, 404);
  });

  it('signup keeps the group and fields when the form leaves them out', async () => {
    let user;
    db.createUser = async (u) => { user = u; };
    const res = await post(makeApp(), '/v1/auth/signup', { inviteToken: 'inv_x', name: 'Ada', password: 'password123' });
    assert.equal(res.status, 201);
    assert.equal(user.userGroup, 'Cohort A');
    assert.deepEqual(user.customFields, { fld_org: 'UIC' });
  });

  it('the form\'s answers win', async () => {
    let user;
    db.createUser = async (u) => { user = u; };
    await post(makeApp(), '/v1/auth/signup', {
      inviteToken: 'inv_x', name: 'Ada', password: 'password123', customFields: { fld_org: 'Other', fld_role: 'Staff' },
    });
    assert.deepEqual(user.customFields, { fld_org: 'Other', fld_role: 'Staff' });
  });

  it('ignores a wait-list group that was renamed or deleted since joining', async () => {
    let user;
    db.createUser = async (u) => { user = u; };
    db.getInvite = async () => ({ ...invite, profile: { ...invite.profile, userGroup: 'Old Cohort' } });
    const res = await post(makeApp(), '/v1/auth/signup', { inviteToken: 'inv_x', name: 'Ada', password: 'password123' });
    assert.equal(res.status, 201);
    assert.equal(user.userGroup, null);
  });

  it('a wait-list entry\'s token cannot sign up', async () => {
    db.getInvite = async () => ({ ...invite, status: 'waitlist' });
    const res = await post(makeApp(), '/v1/auth/signup', { inviteToken: 'inv_x', name: 'Ada', password: 'password123' });
    assert.equal(res.status, 400);
  });
});
