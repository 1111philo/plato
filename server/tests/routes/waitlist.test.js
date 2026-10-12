/**
 * Wait list (#363): the public join form, the admin routes, and signup
 * filling in a wait-list invite's answers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import waitlist from '../../src/routes/waitlist.js';
import admin from '../../src/routes/admin.js';
import auth from '../../src/routes/auth.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { hashToken } from '../../src/lib/crypto.js';

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
  // Fresh copy each test — admin routes mutate settings in place.
  store = { settings: structuredClone(SETTINGS), waitlist: { open: true, apiKeyHash: null } };
  created = [];
  db.getSyncData = async (_u, key) => (key in store ? { data: store[key], version: 1 } : null);
  db.putSyncData = async (_u, key, data) => { store[key] = data; };
  db.getUserByEmail = async () => null;
  db.getUserByUsername = async () => null;
  db.getInviteByEmail = async () => null;
  db.getWaitlistEntryByEmail = async () => null;
  db.createWaitlistEntry = async (entry) => { created.push(entry); };
  db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  db.createAuditLog = async () => {};
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
    assert.deepEqual(created[0].profile, { name: 'Ada', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } });
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

  it('answers the same for a known email, without adding it', async () => {
    db.getUserByEmail = async () => ({ userId: 'usr_1' });
    const res = await post(makeApp(), '/v1/waitlist', VALID);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(created.length, 0);
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

  it('will not invite a pending invite or an unknown token', async () => {
    db.getInvite = async (t) => (t === 'inv_p' ? { inviteToken: 'inv_p', status: 'pending', email: 'b@x.com' } : null);
    assert.equal((await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/inv_p/invite')).status, 404);
    assert.equal((await adminReq(makeApp(), 'POST', '/v1/admin/waitlist/inv_none/invite')).status, 404);
    assert.equal((await adminReq(makeApp(), 'DELETE', '/v1/admin/waitlist/inv_p')).status, 404);
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
    assert.deepEqual(await res.json(), {
      email: 'ada@example.com', name: 'Ada', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' },
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
