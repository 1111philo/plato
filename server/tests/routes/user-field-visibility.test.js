/**
 * Custom user field visibility across routes: a field hidden from learners
 * never reaches a learner or a public form, and one hidden from the API never
 * reaches the public forms or the wait-list API. Admins still see and set both.
 * Hiding never erases stored values.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import app from '../../src/routes/app.js';
import me from '../../src/routes/me.js';
import waitlist, { _resetJoinLimit } from '../../src/routes/waitlist.js';
import auth from '../../src/routes/auth.js';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const FIELDS = [
  { id: 'fld_org', label: 'Organization', type: 'text', required: false },
  { id: 'fld_note', label: 'Admin note', type: 'text', required: false, hideFromLearner: true },
  { id: 'fld_cohort', label: 'Cohort code', type: 'text', required: false, hideFromApi: true },
];
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
let store, user, created, updates;

function server() {
  const s = new Hono();
  for (const r of [me, waitlist, auth, admin, app]) s.route('/', r);
  return s;
}
async function req(method, path, body, role = 'learner') {
  const headers = { 'Content-Type': 'application/json' };
  if (role) headers.Authorization = 'Bearer ' + await signAccessToken(role === 'admin' ? 'usr_admin' : 'usr_ada', role);
  return server().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

beforeEach(() => {
  _resetJoinLimit();
  store = { settings: { userGroups: [], userFields: FIELDS }, waitlist: { open: true } };
  user = { userId: 'usr_ada', email: 'ada@example.com', role: 'learner', firstName: 'Ada', customFields: { fld_org: 'UIC', fld_note: 'VIP', fld_cohort: 'C7' } };
  created = []; updates = [];
  db.getSyncData = async (_u, key) => (key in store ? { data: store[key], version: 1 } : null);
  db.putSyncData = async (_u, key, data) => { store[key] = data; };
  db.getUserById = async (id) => (id === 'usr_admin' ? { userId: 'usr_admin', role: 'admin', name: 'Admin' } : user);
  db.updateUser = async (id, u) => { updates.push(u); user = { ...user, ...u }; return user; };
  db.getUserByEmail = async () => null;
  db.getUserByUsername = async () => null;
  db.getInviteByEmail = async () => null;
  db.getWaitlistEntryByEmail = async () => null;
  db.createWaitlistEntry = async (e) => { created.push(e); };
  db.listAllUsers = async () => [];
  db.createAuditLog = async () => {};
});

describe('field visibility', () => {
  it('the public field list has neither hidden kind', async () => {
    const { userFields } = await (await req('GET', '/v1/user-fields', null, null)).json();
    assert.deepEqual(userFields.map((f) => f.id), ['fld_org']);
  });

  it('a learner never sees an admin-only field or its value; an API-hidden one they do', async () => {
    const meRes = await (await req('GET', '/v1/me')).json();
    assert.deepEqual(meRes.customFields, { fld_org: 'UIC', fld_cohort: 'C7' });
    const fields = await (await req('GET', '/v1/me/fields')).json();
    assert.deepEqual(fields.userFields.map((f) => f.id), ['fld_org', 'fld_cohort']);
    assert.equal(JSON.stringify(fields).includes('VIP'), false);
  });

  it('a learner can’t set or clear an admin-only field; saving keeps its value', async () => {
    const res = await req('PATCH', '/v1/me', { customFields: { fld_org: 'Loyola', fld_note: '', fld_cohort: 'C8' } });
    assert.equal(res.status, 200);
    assert.deepEqual(updates.at(-1).customFields, { fld_org: 'Loyola', fld_note: 'VIP', fld_cohort: 'C8' });
    assert.equal(JSON.stringify(await res.json()).includes('VIP'), false);
  });

  it('the wait-list form and API can’t set hidden fields', async () => {
    const res = await req('POST', '/v1/waitlist', { name: 'Bo', email: 'bo@example.com', customFields: { fld_org: 'UIC', fld_note: 'x', fld_cohort: 'y' } }, null);
    assert.equal(res.status, 202);
    assert.deepEqual(created[0].profile.customFields, { fld_org: 'UIC' });
  });

  it('an admin editing a wait-list entry sets any field', async () => {
    const entry = { inviteToken: 'inv_wl1', email: 'bo@example.com', status: 'waitlist', createdAt: '2026-11-06', profile: { firstName: 'Bo', customFields: {} } };
    db.getInvite = async () => entry;
    let saved;
    db.updateWaitlistEntry = async (_t, u) => { saved = u; };
    const res = await req('PUT', '/v1/admin/waitlist/inv_wl1', { firstName: 'Bo', email: 'bo@example.com', customFields: { fld_org: 'UIC', fld_note: 'VIP', fld_cohort: 'C7' } }, 'admin');
    assert.equal(res.status, 200);
    assert.deepEqual(saved.profile.customFields, { fld_org: 'UIC', fld_note: 'VIP', fld_cohort: 'C7' });
  });

  it('an invite shows only public answers, and signup keeps the admin-set ones', async () => {
    const invite = { inviteToken: 'inv_1', email: 'bo@example.com', status: 'pending', ttl: FUTURE, profile: { firstName: 'Bo', customFields: { fld_org: 'UIC', fld_note: 'VIP', fld_cohort: 'C7' } } };
    db.getInvite = async () => invite;
    const shown = await (await req('GET', '/v1/auth/invite/inv_1', null, null)).json();
    assert.deepEqual(shown.customFields, { fld_org: 'UIC' });
    let createdUser;
    db.createUser = async (u) => { createdUser = u; };
    db.markInviteUsed = async () => {};
    db.incrementLinkUsage = async () => true;
    db.storeRefreshToken = async () => {};
    const res = await req('POST', '/v1/auth/signup', { inviteToken: 'inv_1', firstName: 'Bo', username: 'bobo', password: 'longenough123', customFields: { fld_org: 'Loyola', fld_note: 'hacked', fld_cohort: 'hacked' } }, null);
    assert.equal(res.status, 201, await res.clone().text());
    assert.deepEqual(createdUser.customFields, { fld_org: 'Loyola', fld_note: 'VIP', fld_cohort: 'C7' });
  });
});
