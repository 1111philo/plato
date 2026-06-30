/**
 * Link invite tests — test the new shareable invite link feature
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../src/routes/admin.js';
import auth from '../src/routes/auth.js';
import { signAccessToken } from '../src/lib/jwt.js';
import db from '../src/lib/db.js';

async function adminReq(app, method, path, body) {
  const token = await signAccessToken('usr_admin', 'admin');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let app;

beforeEach(async () => {
  app = new Hono();
  app.route('/', admin);
  app.route('/', auth);

  // Mock getUserById for auth middleware
  db.getUserById = async (id) => {
    if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin', email: 'admin@example.com' };
    return null;
  };

  // Mock audit log creation
  db.createAuditLog = async () => {};
});

describe('Link Invites', () => {
  it('should create a link invite', async () => {
    const res = await adminReq(app, 'POST', '/v1/admin/invites/link');
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.inviteToken);
    assert.ok(data.inviteToken.startsWith('inv_'));
    assert.strictEqual(data.usageCount, 0);
  });

  it('should get the current link invite', async () => {
    // Create first
    await adminReq(app, 'POST', '/v1/admin/invites/link');

    // Then get
    const res = await adminReq(app, 'GET', '/v1/admin/invites/link');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.inviteToken);
    assert.strictEqual(data.usageCount, 0);
  });

  it('should regenerate a link invite (delete old, create new)', async () => {
    // Create first
    const res1 = await adminReq(app, 'POST', '/v1/admin/invites/link');
    const data1 = await res1.json();
    const oldToken = data1.inviteToken;

    // Regenerate
    const res2 = await adminReq(app, 'POST', '/v1/admin/invites/link');
    const data2 = await res2.json();
    const newToken = data2.inviteToken;

    assert.notStrictEqual(oldToken, newToken);
  });

  it('should delete a link invite', async () => {
    // Create first
    await adminReq(app, 'POST', '/v1/admin/invites/link');

    // Delete
    const res = await adminReq(app, 'DELETE', '/v1/admin/invites/link');
    assert.strictEqual(res.status, 200);

    // Verify it's gone
    const getRes = await adminReq(app, 'GET', '/v1/admin/invites/link');
    const data = await getRes.json();
    assert.strictEqual(data, null);
  });

  it('should allow signup with link invite and any email', async () => {
    // Create link invite
    const inviteRes = await adminReq(app, 'POST', '/v1/admin/invites/link');
    const inviteData = await inviteRes.json();

    // Sign up with any email
    const signupRes = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: inviteData.inviteToken,
        email: 'newuser@example.com',
        name: 'New User',
        password: 'password123',
      }),
    });
    assert.strictEqual(signupRes.status, 201);
    const signupData = await signupRes.json();
    assert.ok(signupData.accessToken);
    assert.strictEqual(signupData.user.email, 'newuser@example.com');
  });

  it('should increment usage count after signup', async () => {
    // Create link invite
    const inviteRes = await adminReq(app, 'POST', '/v1/admin/invites/link');
    const inviteData = await inviteRes.json();

    // Sign up
    await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: inviteData.inviteToken,
        email: 'user1@example.com',
        name: 'User One',
        password: 'password123',
      }),
    });

    // Check usage count
    const getRes = await adminReq(app, 'GET', '/v1/admin/invites/link');
    const data = await getRes.json();
    assert.strictEqual(data.usageCount, 1);
  });

  it('should require email in signup for link invites', async () => {
    // Create link invite
    const inviteRes = await adminReq(app, 'POST', '/v1/admin/invites/link');
    const inviteData = await inviteRes.json();

    // Try to sign up without email
    const signupRes = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: inviteData.inviteToken,
        name: 'User Without Email',
        password: 'password123',
      }),
    });
    assert.strictEqual(signupRes.status, 400);
    const data = await signupRes.json();
    assert.ok(data.error.includes('Email is required'));
  });
});
