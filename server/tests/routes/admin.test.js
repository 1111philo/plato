import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

async function adminReq(app, method, path, body) {
  const token = await signAccessToken('usr_admin', 'admin');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function userReq(app, method, path, body) {
  const token = await signAccessToken('usr_user', 'user');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /v1/admin/users', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
  });

  it('returns user list for admin', async () => {
    db.listAllUsers = async () => [
      { userId: 'usr_1', email: 'a@x.com', name: 'A', userGroup: null, role: 'user', createdAt: '2024-01-01' },
    ];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].email, 'a@x.com');
  });

  it('rejects non-admin', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await userReq(app, 'GET', '/v1/admin/users');
    assert.equal(res.status, 403);
  });
});

describe('POST /v1/admin/invites', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    db.createInvite = async () => {};
  });

  it('creates invite', async () => {
    // Stub sendInviteEmail via dynamic import mock approach
    const { sendInviteEmail } = await import('../../src/lib/email.js');
    // Since we can't easily mock SES in this test, we set SKIP_EMAIL
    process.env.SKIP_EMAIL = 'true';
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites', { email: 'new@example.com' });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.inviteToken);
    assert.equal(data.email, 'new@example.com');
    delete process.env.SKIP_EMAIL;
  });

  it('rejects existing email', async () => {
    db.getUserByEmail = async () => ({ userId: 'usr_existing' });
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites', { email: 'existing@example.com' });
    assert.equal(res.status, 409);
  });
});

describe('POST /v1/admin/invites/bulk', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    db.createInvite = async () => {};
    process.env.SKIP_EMAIL = 'true';
  });

  afterEach(() => {
    delete process.env.SKIP_EMAIL;
  });

  it('sends multiple invites', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {
      emails: ['a@example.com', 'b@example.com'],
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sent, 2);
    assert.equal(data.skipped, 0);
    assert.equal(data.total, 2);
  });

  it('skips existing users', async () => {
    db.getUserByEmail = async (email) => email === 'exists@example.com' ? { userId: 'usr_x' } : null;
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {
      emails: ['exists@example.com', 'new@example.com'],
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sent, 1);
    assert.equal(data.skipped, 1);
    assert.equal(data.results[0].status, 'skipped');
    assert.equal(data.results[1].status, 'sent');
  });

  it('rejects invalid emails', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {
      emails: ['not-an-email', 'valid@example.com'],
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sent, 1);
    assert.equal(data.skipped, 1);
    assert.equal(data.results[0].status, 'invalid');
  });

  it('rejects empty array', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', { emails: [] });
    assert.equal(res.status, 400);
  });

  it('rejects missing emails field', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {});
    assert.equal(res.status, 400);
  });
});

describe('GET /v1/invite-example.csv', () => {
  it('returns CSV with example emails (no auth required)', async () => {
    const { default: appRoutes } = await import('../../src/routes/app.js');
    const app = new Hono();
    app.route('/', appRoutes);
    const res = await app.request('/v1/invite-example.csv');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.startsWith('email'));
    assert.ok(text.includes('jane@example.com'));
    assert.equal(res.headers.get('Content-Type'), 'text/csv');
  });
});

describe('DELETE /v1/admin/users/:userId', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_p1') return { userId: 'usr_p1', role: 'user', name: 'P1' };
      return null;
    };
    db.deleteUser = async () => {};
  });

  it('deletes user and sync data', async () => {
    let deleted = false;
    db.getAllSyncData = async () => [{ dataKey: 'profile' }, { dataKey: 'work' }];
    db.deleteSyncData = async () => {};
    db.deleteUser = async () => { deleted = true; };
    db.createAuditLog = async () => {};
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'DELETE', '/v1/admin/users/usr_p1');
    assert.equal(res.status, 200);
    assert.ok(deleted);
  });
});
