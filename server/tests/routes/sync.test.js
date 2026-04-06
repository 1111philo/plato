import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import sync from '../../src/routes/sync.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

async function authedReq(app, method, path, body) {
  const token = await signAccessToken('usr_test', 'user');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /v1/sync', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
  });

  it('returns all sync data', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'profile', data: { name: 'Test' }, version: 1, updatedAt: '2024-01-01T00:00:00Z' },
    ];
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'GET', '/v1/sync');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].dataKey, 'profile');
  });
});

describe('PUT /v1/sync/:dataKey', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
  });

  it('upserts data', async () => {
    db.putSyncData = async () => ({ version: 2, updatedAt: '2024-01-01T00:00:00Z' });
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'PUT', '/v1/sync/profile', { data: { name: 'Test' }, version: 1 });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.version, 2);
  });

  it('returns 409 on version conflict', async () => {
    const err = new Error('conflict');
    err.name = 'ConditionalCheckFailedException';
    db.putSyncData = async () => { throw err; };
    db.getSyncData = async () => ({ version: 5 });
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'PUT', '/v1/sync/profile', { data: { name: 'Test' }, version: 1 });
    assert.equal(res.status, 409);
    const result = await res.json();
    assert.equal(result.serverVersion, 5);
  });

  it('rejects invalid dataKey', async () => {
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'PUT', '/v1/sync/invalid-key', { data: {} });
    assert.equal(res.status, 400);
  });

  it('accepts progress:lessonId keys', async () => {
    db.putSyncData = async () => ({ version: 1, updatedAt: '2024-01-01T00:00:00Z' });
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'PUT', '/v1/sync/progress:basics-wordpress', { data: {}, version: 0 });
    assert.equal(res.status, 200);
  });
});

describe('PUT /v1/sync/batch', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
  });

  it('processes batch items', async () => {
    db.putSyncData = async () => ({ version: 2, updatedAt: '2024-01-01T00:00:00Z' });
    db.updateUser = async () => {};
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'PUT', '/v1/sync/batch', {
      items: [
        { dataKey: 'profile', data: { x: 1 }, version: 1 },
        { dataKey: 'preferences', data: { name: 'A' }, version: 0 },
      ],
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].status, 'ok');
  });
});

describe('DELETE /v1/sync', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
  });

  it('deletes all sync data', async () => {
    const deleted = [];
    db.getAllSyncData = async () => [
      { dataKey: 'profile' },
      { dataKey: 'work' },
      { dataKey: 'preferences' },
    ];
    db.deleteSyncData = async (_uid, key) => { deleted.push(key); };
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'DELETE', '/v1/sync');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.deleted, 3);
    assert.deepEqual(deleted, ['profile', 'work', 'preferences']);
  });

  it('returns 0 when no sync data exists', async () => {
    db.getAllSyncData = async () => [];
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'DELETE', '/v1/sync');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.deleted, 0);
  });
});

describe('DELETE /v1/sync/:dataKey', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
  });

  it('deletes sync data', async () => {
    let deleted = false;
    db.deleteSyncData = async () => { deleted = true; };
    const app = new Hono();
    app.route('/', sync);
    const res = await authedReq(app, 'DELETE', '/v1/sync/profile');
    assert.equal(res.status, 200);
    assert.ok(deleted);
  });
});
