import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import auth from '../../src/routes/auth.js';
import admin from '../../src/routes/admin.js';
import me from '../../src/routes/me.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { on as onHook, _reset as resetHooks } from '../../src/lib/plugins/hooks.js';

const origLog = console.log;
const origWarn = console.warn;
const origErr = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

function req(app, method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return app.request(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('userCreated hook fires on signup', () => {
  beforeEach(() => {
    resetHooks();
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: 'newuser@example.com',
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) + 86400,
    });
    db.getUserByEmail = async () => null;
    db.getUserByUsername = async () => null;
    db.createUser = async () => {};
    db.markInviteUsed = async () => {};
    db.storeRefreshToken = async () => {};
  });

  it('emits userCreated with the new user details', async () => {
    const seen = [];
    onHook('userCreated', (payload) => seen.push(payload));
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/signup', {
      inviteToken: 'inv_test', name: 'New User', password: 'password123',
    });
    assert.equal(res.status, 201);
    assert.equal(seen.length, 1, 'expected userCreated to fire once');
    assert.equal(seen[0].email, 'newuser@example.com');
    assert.equal(seen[0].role, 'user');
    assert.ok(seen[0].userId, 'userId in payload');
  });

  it('hook errors do not fail the signup request', async () => {
    onHook('userCreated', () => { throw new Error('handler boom'); });
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/signup', {
      inviteToken: 'inv_test', name: 'New User', password: 'password123',
    });
    // The signup still succeeds even with a buggy plugin handler.
    assert.equal(res.status, 201);
  });
});

describe('userDeleted hook fires on self-delete', () => {
  beforeEach(() => {
    resetHooks();
    db.getUserById = async () => ({
      userId: 'usr_self', email: 'self@example.com', role: 'user', name: 'Self',
    });
    db.createAuditLog = async () => {};
    db.getAllSyncData = async () => [];
    db.deleteSyncData = async () => {};
    db.deleteUser = async () => {};
  });

  it('emits userDeleted before the cascade with the user details', async () => {
    const seen = [];
    onHook('userDeleted', (payload) => seen.push(payload));
    const app = new Hono();
    app.route('/', me);
    const token = await signAccessToken('usr_self', 'user');
    const res = await req(app, 'DELETE', '/v1/me', { confirm: 'DELETE' }, token);
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].userId, 'usr_self');
    assert.equal(seen[0].email, 'self@example.com');
    assert.equal(seen[0].role, 'user');
  });
});

describe('userDeleted hook fires on admin-delete', () => {
  beforeEach(() => {
    resetHooks();
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_target') return { userId: 'usr_target', email: 'target@example.com', role: 'user', name: 'Target' };
      return null;
    };
    db.createAuditLog = async () => {};
    db.getAllSyncData = async () => [];
    db.deleteSyncData = async () => {};
    db.deleteUser = async () => {};
  });

  it('emits userDeleted with the deleted user\'s details', async () => {
    const seen = [];
    onHook('userDeleted', (payload) => seen.push(payload));
    const app = new Hono();
    app.route('/', admin);
    const token = await signAccessToken('usr_admin', 'admin');
    const res = await req(app, 'DELETE', '/v1/admin/users/usr_target', null, token);
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].userId, 'usr_target');
    assert.equal(seen[0].email, 'target@example.com');
  });
});

process.on('exit', () => { console.log = origLog; console.warn = origWarn; console.error = origErr; });
