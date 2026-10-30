/**
 * Admin notification routes (#388, #389, #400) and the learner's email
 * settings, against a mocked db.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import me from '../../src/routes/me.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { setEmailTransport } from '../../src/lib/notifications.js';

let store;
let mails;
let role;
const app = () => { const a = new Hono(); a.route('/', admin); a.route('/', me); return a; };
async function req(method, path, body, userId = 'usr_admin') {
  const token = await signAccessToken(userId, role);
  return app().request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  store = {};
  mails = [];
  role = 'admin';
  setEmailTransport(async (raw) => { mails.push(raw); });
  db.getSyncData = async (u, key) => (store[`${u}:${key}`] ? { data: store[`${u}:${key}`], version: 1, updatedAt: 'now' } : null);
  db.putSyncData = async (u, key, data) => { store[`${u}:${key}`] = structuredClone(data); };
  db.deleteSyncData = async (u, key) => { delete store[`${u}:${key}`]; };
  db.getUserById = async (id) => ({ userId: id, role, email: 'admin@x.com', username: 'admin', firstName: 'Ann', lastName: 'Admin' });
});

describe('admin notifications', () => {
  it('lists automations (all off) and every template with its default copy', async () => {
    const data = await (await req('GET', '/v1/admin/notifications')).json();
    assert.deepEqual(data.automations, { waitlistConfirmation: false, inactivityNudge: false, weeklyDigest: false });
    assert.deepEqual(data.templates.map((t) => [t.id, t.isDefault]), [['waitlist-confirmation', true], ['inactivity-nudge', true], ['weekly-digest', true]]);
  });

  it('turns an automation on', async () => {
    const res = await req('PUT', '/v1/admin/notifications/automations', { waitlistConfirmation: true });
    assert.equal((await res.json()).automations.waitlistConfirmation, true);
    assert.equal((await req('PUT', '/v1/admin/notifications/automations', { nope: true })).status, 400);
  });

  it('saves, validates, and resets a template', async () => {
    assert.equal((await req('PUT', '/v1/admin/notifications/templates/waitlist-confirmation', { subject: 'Hi {{oops}}', body: 'x' })).status, 400);
    const saved = await (await req('PUT', '/v1/admin/notifications/templates/waitlist-confirmation', { subject: 'Hi {{firstName}}', body: 'Thanks' })).json();
    assert.equal(saved.template.isDefault, false);
    const reset = await (await req('DELETE', '/v1/admin/notifications/templates/waitlist-confirmation')).json();
    assert.equal(reset.template.isDefault, true);
    assert.equal((await req('PUT', '/v1/admin/notifications/templates/nope', { subject: 'x', body: 'y' })).status, 404);
  });

  it('sends a test of an unsaved draft to the admin, with sample values', async () => {
    const res = await req('POST', '/v1/admin/notifications/templates/inactivity-nudge/test', { subject: 'Back to {{lessonName}}, {{firstName}}', body: 'Hi {{firstName}}\n\n{{link}}' });
    assert.deepEqual(await res.json(), { sent: true, to: 'admin@x.com' });
    assert.match(mails[0], /^To: admin@x\.com$/m);
    assert.match(mails[0], /^Subject: \[Test\] Back to Getting Started, Ann$/m);
    assert.ok(!/List-Unsubscribe/.test(mails[0]));
  });

  it('testers can read but not change anything', async () => {
    role = 'tester';
    assert.equal((await req('GET', '/v1/admin/notifications')).status, 200);
    assert.equal((await req('PUT', '/v1/admin/notifications/automations', { weeklyDigest: true })).status, 403);
    assert.equal((await req('POST', '/v1/admin/notifications/templates/weekly-digest/test', {})).status, 403);
  });

  it('educators get no access', async () => {
    role = 'educator';
    assert.equal((await req('GET', '/v1/admin/notifications')).status, 403);
  });
});

describe('learner email settings (/v1/me/notifications)', () => {
  it('reads and sets opt-outs, refusing unknown kinds', async () => {
    role = 'learner';
    assert.deepEqual(await (await req('GET', '/v1/me/notifications', null, 'usr_ada')).json(), { optOut: {} });
    const res = await req('PUT', '/v1/me/notifications', { optOut: { digest: true } }, 'usr_ada');
    assert.deepEqual(await res.json(), { optOut: { digest: true } });
    assert.deepEqual(store['usr_ada:notify:state'].optOut, { digest: true });
    assert.equal((await req('PUT', '/v1/me/notifications', { optOut: { all: true } }, 'usr_ada')).status, 400);
  });
});
