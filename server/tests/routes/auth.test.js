import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import auth from '../../src/routes/auth.js';
import db from '../../src/lib/db.js';

function req(app, method, path, body) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /v1/auth/signup', () => {
  beforeEach(() => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: 'test@example.com',
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) + 86400,
    });
    db.getUserByEmail = async () => null;
    db.createUser = async () => {};
    db.markInviteUsed = async () => {};
    db.storeRefreshToken = async () => {};
  });

  it('creates user with valid invite', async () => {
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/signup', {
      inviteToken: 'inv_test', name: 'Test', password: 'password123',
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
    assert.equal(data.user.email, 'test@example.com');
    assert.equal(data.user.role, 'participant');
  });

  it('rejects expired invite', async () => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test', email: 'test@example.com', status: 'pending',
      ttl: Math.floor(Date.now() / 1000) - 1000,
    });
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/signup', {
      inviteToken: 'inv_test', name: 'Test', password: 'password123',
    });
    assert.equal(res.status, 400);
  });

  it('rejects short password', async () => {
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/signup', {
      inviteToken: 'inv_test', name: 'Test', password: 'short',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('8 characters'));
  });

  it('rejects used invite', async () => {
    db.getInvite = async () => ({ inviteToken: 'inv_test', email: 'test@example.com', status: 'used' });
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/signup', {
      inviteToken: 'inv_test', name: 'Test', password: 'password123',
    });
    assert.equal(res.status, 400);
  });
});

describe('POST /v1/auth/login', () => {
  beforeEach(() => {
    db.storeRefreshToken = async () => {};
  });

  it('logs in with correct credentials', async () => {
    const { hashPassword } = await import('../../src/lib/password.js');
    const hash = await hashPassword('password123');
    db.getUserByEmail = async () => ({
      userId: 'usr_test', email: 'test@example.com', name: 'Test',
      role: 'participant', passwordHash: hash,
    });
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/login', { email: 'test@example.com', password: 'password123' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
  });

  it('rejects wrong password', async () => {
    const { hashPassword } = await import('../../src/lib/password.js');
    const hash = await hashPassword('correctpass');
    db.getUserByEmail = async () => ({
      userId: 'usr_test', email: 'test@example.com', name: 'Test',
      role: 'participant', passwordHash: hash,
    });
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/login', { email: 'test@example.com', password: 'wrongpassword' });
    assert.equal(res.status, 401);
  });

  it('rejects unknown email', async () => {
    db.getUserByEmail = async () => null;
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/login', { email: 'nobody@example.com', password: 'password123' });
    assert.equal(res.status, 401);
  });
});

describe('POST /v1/auth/refresh', () => {
  it('rotates refresh tokens', async () => {
    db.getRefreshToken = async () => ({ tokenHash: 'hash', userId: 'usr_test' });
    db.getUserById = async () => ({ userId: 'usr_test', role: 'participant' });
    db.deleteRefreshToken = async () => {};
    db.storeRefreshToken = async () => {};
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/refresh', { refreshToken: 'rt_test' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
  });

  it('rejects invalid refresh token', async () => {
    db.getRefreshToken = async () => null;
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/refresh', { refreshToken: 'rt_invalid' });
    assert.equal(res.status, 401);
  });
});

describe('POST /v1/auth/logout', () => {
  it('deletes refresh token', async () => {
    let deleted = false;
    db.deleteRefreshToken = async () => { deleted = true; };
    const app = new Hono();
    app.route('/', auth);
    const res = await req(app, 'POST', '/v1/auth/logout', { refreshToken: 'rt_test' });
    assert.equal(res.status, 200);
    assert.ok(deleted);
  });
});
