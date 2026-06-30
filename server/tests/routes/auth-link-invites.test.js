/**
 * Link invite signup flow tests
 * Tests the new link invite validation path in auth.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import auth from '../../src/routes/auth.js';
import db from '../../src/lib/db.js';

let app;

beforeEach(() => {
  app = new Hono();
  app.route('/', auth);

  // Mock db functions
  db.getUserByEmail = async () => null;
  db.getUserByUsername = async () => null;
  db.createUser = async () => {};
  db.storeRefreshToken = async () => {};
});

describe('Link invite signup', () => {
  it('accepts link invite with valid email', async () => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: null,
      isLink: true,
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) + 86400,
      usageCount: 0,
      maxUsages: null,
    });
    db.incrementLinkUsage = async () => {};

    const res = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        email: 'newuser@example.com',
        name: 'New User',
        password: 'password123',
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.equal(data.user.email, 'newuser@example.com');
  });

  it('rejects link invite without email', async () => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: null,
      isLink: true,
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) + 86400,
    });

    const res = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        name: 'New User',
        password: 'password123',
      }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Email is required'));
  });

  it('rejects expired link invite', async () => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: null,
      isLink: true,
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) - 1, // Expired
    });

    const res = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        email: 'newuser@example.com',
        name: 'New User',
        password: 'password123',
      }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Invalid or expired invite'));
  });

  it('enforces maxUsages limit atomically (race condition test)', async () => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: null,
      isLink: true,
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) + 86400,
      usageCount: 9,
      maxUsages: 10,
    });

    // First call succeeds
    let incrementCallCount = 0;
    db.incrementLinkUsage = async () => {
      incrementCallCount++;
      if (incrementCallCount > 1) {
        // Simulate atomic limit check failing
        const err = new Error('Usage limit reached');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
    };

    // First signup succeeds
    const res1 = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        email: 'user1@example.com',
        name: 'User One',
        password: 'password123',
      }),
    });
    assert.equal(res1.status, 201);

    // Second signup fails (limit reached)
    const res2 = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        email: 'user2@example.com',
        name: 'User Two',
        password: 'password123',
      }),
    });
    assert.equal(res2.status, 400);
    const data = await res2.json();
    assert.ok(data.error.includes('usage limit'));
  });

  it('allows email-specific invite only with matching email', async () => {
    db.getInvite = async () => ({
      inviteToken: 'inv_test',
      email: 'invited@example.com',
      isLink: false,
      status: 'pending',
      ttl: Math.floor(Date.now() / 1000) + 86400,
    });
    db.markInviteUsed = async () => {};

    // Wrong email fails
    const res1 = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        email: 'wrong@example.com',
        name: 'Wrong User',
        password: 'password123',
      }),
    });
    assert.equal(res1.status, 400);

    // Correct email succeeds
    const res2 = await app.request('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: 'inv_test',
        email: 'invited@example.com',
        name: 'Right User',
        password: 'password123',
      }),
    });
    assert.equal(res2.status, 201);
  });

});
