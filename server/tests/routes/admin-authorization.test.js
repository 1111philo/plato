/**
 * /v1/admin/* authorization end to end through the real admin app (#435):
 * authenticate loads the role from the DB, authorize applies the matrix.
 * Handlers below the gate are stubbed out by making db calls return empty;
 * what matters is 403 vs not-403.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const ROLE_OF = { usr_admin: 'admin', usr_edu: 'educator', usr_test: 'tester', usr_learn: 'learner', usr_legacy: 'user' };

beforeEach(() => {
  db.getUserById = async (id) => (ROLE_OF[id] ? { userId: id, role: ROLE_OF[id], email: `${id}@x.com`, name: id } : null);
  db.listAllUsers = async () => [];
  db.listInvites = async () => [];
  db.getAllSyncData = async () => [];
  db.getSyncData = async () => null;
  db.getSyncDataByPrefix = async () => [];
  db.putSyncData = async () => ({ version: 1 });
  db.createAuditLog = async () => {};
});

async function call(userId, method, path, body) {
  const app = new Hono();
  app.route('/', admin);
  const token = await signAccessToken(userId, ROLE_OF[userId]);
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const forbidden = async (...args) => (await call(...args)).status === 403;

describe('admin authorization', () => {
  it('learners, including legacy role "user", are refused everywhere', async () => {
    for (const u of ['usr_learn', 'usr_legacy']) {
      assert.ok(await forbidden(u, 'GET', '/v1/admin/users'));
      assert.ok(await forbidden(u, 'GET', '/v1/admin/lessons'));
    }
  });

  it('admin passes the gate on every kind of route', async () => {
    for (const [m, p] of [['GET', '/v1/admin/users'], ['GET', '/v1/admin/logs?cloudwatch=0'], ['GET', '/v1/admin/plugins']]) {
      assert.equal(await forbidden('usr_admin', m, p), false, `${m} ${p}`);
    }
  });

  it('educators read users and manage content, but cannot touch configuration or roles', async () => {
    assert.equal(await forbidden('usr_edu', 'GET', '/v1/admin/users'), false);
    assert.equal(await forbidden('usr_edu', 'GET', '/v1/admin/lessons'), false);
    for (const [m, p, b] of [
      ['PUT', '/v1/admin/users/usr_learn/role', { role: 'admin' }],
      ['DELETE', '/v1/admin/users/usr_learn'],
      ['PUT', '/v1/admin/theme', {}],
      ['PUT', '/v1/admin/settings', {}],
      ['GET', '/v1/admin/logs'],
      ['POST', '/v1/admin/impersonation/start', { targetUserId: 'usr_learn' }],
      ['PUT', '/v1/admin/plugins/slack/activation', { enabled: true }],
    ]) assert.ok(await forbidden('usr_edu', m, p, b), `${m} ${p}`);
  });

  it('testers read every admin area and are refused every write', async () => {
    for (const p of ['/v1/admin/users', '/v1/admin/lessons', '/v1/admin/plugins', '/v1/admin/settings', '/v1/admin/logs?cloudwatch=0']) {
      assert.equal(await forbidden('usr_test', 'GET', p), false, p);
    }
    for (const [m, p, b] of [
      ['PUT', '/v1/admin/lessons/l1', { name: 'x' }],
      ['POST', '/v1/admin/invites', { email: 'a@b.co' }],
      ['PATCH', '/v1/admin/users/usr_learn', { name: 'x' }],
      ['PUT', '/v1/admin/settings', {}],
      ['DELETE', '/v1/admin/courses/c1'],
    ]) assert.ok(await forbidden('usr_test', m, p, b), `${m} ${p}`);
  });

  it('the 403 says which permission was missing', async () => {
    const res = await call('usr_edu', 'PUT', '/v1/admin/theme', {});
    assert.deepEqual(await res.json(), { error: 'You do not have permission to do that', code: 'forbidden', permission: 'theme.write' });
  });
});
