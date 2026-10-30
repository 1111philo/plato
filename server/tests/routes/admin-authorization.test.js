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

describe('PUT /v1/admin/users/:userId/role', () => {
  let users;
  let audits;
  let updates;
  beforeEach(() => {
    users = [
      { userId: 'usr_admin', role: 'admin', email: 'a@x.com' },
      { userId: 'usr_admin2', role: 'admin', email: 'a2@x.com' },
      { userId: 'usr_learn', role: 'user', email: 'l@x.com' },
    ];
    audits = []; updates = [];
    db.getUserById = async (id) => users.find((u) => u.userId === id) || (ROLE_OF[id] ? { userId: id, role: ROLE_OF[id] } : null);
    db.listAllUsers = async () => users;
    db.updateUser = async (userId, u) => { updates.push({ userId, ...u }); };
    // Conditional, like the real backends: applies only if the stored role is still `from`.
    db.setUserRoleIf = async (userId, from, to) => {
      const u = users.find((x) => x.userId === userId);
      if (!u || u.role !== from) return false;
      u.role = to;
      updates.push({ userId, role: to });
      return true;
    };
    db.createAuditLog = async (e) => { audits.push(e); };
  });

  it('assigns each of the four roles in turn and audits each change', async () => {
    let previous = 'learner'; // stored as legacy 'user'
    for (const role of ['educator', 'tester', 'learner', 'admin']) {
      const res = await call('usr_admin', 'PUT', '/v1/admin/users/usr_learn/role', { role });
      assert.equal(res.status, 200, role);
      assert.equal(users.find((u) => u.userId === 'usr_learn').role, role);
      assert.deepEqual(audits.at(-1).details, { from: previous, to: role });
      assert.equal(audits.at(-1).action, 'role_changed');
      previous = role;
    }
  });

  it("accepts the legacy 'user' name as learner and rejects unknown roles", async () => {
    users[2].role = 'educator';
    const res = await call('usr_admin', 'PUT', '/v1/admin/users/usr_learn/role', { role: 'user' });
    assert.equal(res.status, 200);
    assert.equal(updates.at(-1).role, 'learner');
    assert.equal((await call('usr_admin', 'PUT', '/v1/admin/users/usr_learn/role', { role: 'owner' })).status, 400);
  });

  it('an admin cannot change their own role', async () => {
    const res = await call('usr_admin', 'PUT', '/v1/admin/users/usr_admin/role', { role: 'learner' });
    assert.equal(res.status, 400);
  });

  it('demoting one of two admins is allowed', async () => {
    const res = await call('usr_admin', 'PUT', '/v1/admin/users/usr_admin2/role', { role: 'educator' });
    assert.equal(res.status, 200);
    assert.deepEqual(audits.at(-1).details, { from: 'admin', to: 'educator' });
  });

  it('the last-admin guard counts admins from the DB', async () => {
    // Two admins: caller usr_admin, target usr_admin2 → fine. Then remove the
    // caller's admin status in the DB copy only for counting purposes: the
    // guard must see a single admin and refuse.
    users = [{ userId: 'usr_admin', role: 'admin' }, { userId: 'usr_admin2', role: 'admin' }];
    const listing = users;
    db.listAllUsers = async () => listing.filter((u) => u.userId === 'usr_admin2'); // DB reports one admin
    const res = await call('usr_admin', 'PUT', '/v1/admin/users/usr_admin2/role', { role: 'learner' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /only admin/);
  });

  it('two admins demoting each other at the same moment never leaves zero admins', async () => {
    users = [{ userId: 'usr_admin', role: 'admin' }, { userId: 'usr_admin2', role: 'admin' }];
    // Interleave: every read and write yields to the event loop, so both
    // requests pass the pre-check before either writes (the reviewed race).
    const tick = () => new Promise((r) => setImmediate(r));
    db.getUserById = async (id) => { await tick(); return users.find((u) => u.userId === id) ? { ...users.find((u) => u.userId === id) } : null; };
    db.listAllUsers = async () => { await tick(); return users.map((u) => ({ ...u })); };
    const setIf = db.setUserRoleIf;
    db.setUserRoleIf = async (...args) => { await tick(); return setIf(...args); };
    const [a, b] = await Promise.all([
      call('usr_admin', 'PUT', '/v1/admin/users/usr_admin2/role', { role: 'learner' }),
      call('usr_admin2', 'PUT', '/v1/admin/users/usr_admin/role', { role: 'learner' }),
    ]);
    const admins = users.filter((u) => u.role === 'admin').length;
    assert.ok(admins >= 1, `admins left: ${admins} (statuses ${a.status}, ${b.status})`);
  });

  it('refuses to overwrite a role that changed since it was read', async () => {
    const realGet = db.getUserById;
    db.getUserById = async (id) => {
      const u = { ...(await realGet(id)) }; // the handler's snapshot
      if (id === 'usr_learn') users.find((x) => x.userId === 'usr_learn').role = 'tester'; // changed right after it read
      return u;
    };
    const res = await call('usr_admin', 'PUT', '/v1/admin/users/usr_learn/role', { role: 'educator' });
    assert.equal(res.status, 409);
    assert.equal(users.find((x) => x.userId === 'usr_learn').role, 'tester', 'the concurrent change stands');
  });

  it('only admins can change roles', async () => {
    for (const u of ['usr_edu', 'usr_test']) {
      assert.equal((await call(u, 'PUT', '/v1/admin/users/usr_learn/role', { role: 'admin' })).status, 403);
    }
  });
});
