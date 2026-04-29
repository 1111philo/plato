import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import plugin from '../../../plugins/teacher-comments/server/index.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

function buildApp() {
  const app = new Hono();
  app.route('/', plugin.routes);
  return app;
}

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

/**
 * In-memory fake of getSyncData/putSyncData/deleteSyncData scoped per
 * (userId, dataKey). Plugin storage now goes through the per-user
 * `userMeta:teacher-comments` namespace, so each comment is its own record.
 */
function fakeUserSyncStore() {
  const store = new Map(); // key: `${userId}\0${dataKey}` -> { data, version }
  const k = (userId, key) => `${userId}\0${key}`;
  return {
    getSyncData: async (userId, key) => store.get(k(userId, key)) || null,
    putSyncData: async (userId, key, data, expectedVersion) => {
      const cur = store.get(k(userId, key));
      const ver = cur?.version || 0;
      if (expectedVersion !== ver) {
        const err = new Error('version conflict');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      const next = { data, version: ver + 1 };
      store.set(k(userId, key), next);
      return next;
    },
    deleteSyncData: async (userId, key) => { store.delete(k(userId, key)); },
    _peek: () => store,
  };
}

describe('teacher-comments plugin', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
    db.listAllUsers = async () => [
      { userId: 'usr_x', email: 'x@example.com', role: 'user' },
      { userId: 'usr_y', email: 'y@example.com', role: 'user' },
    ];
  });

  it('rejects non-admin', async () => {
    const app = buildApp();
    const res = await userReq(app, 'GET', '/admin/comments');
    assert.equal(res.status, 403);
  });

  it('GET /admin/comments returns empty map by default', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const res = await adminReq(app, 'GET', '/admin/comments');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {});
  });

  it('PUT then GET round-trips a comment', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const put = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'Strong reasoner.' });
    assert.equal(put.status, 200);
    const get = await adminReq(app, 'GET', '/admin/comments/usr_x');
    const data = await get.json();
    assert.equal(data.text, 'Strong reasoner.');
    assert.equal(data.updatedBy, 'usr_admin');
    assert.ok(data.updatedAt);
  });

  it('PUT empty text deletes the entry', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'temp' });
    const del = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: '' });
    assert.equal(del.status, 200);
    const list = await adminReq(app, 'GET', '/admin/comments');
    assert.deepEqual(await list.json(), {});
  });

  it('PUT validates text type and length', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const wrongType = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 12345 });
    assert.equal(wrongType.status, 400);
    const tooLong = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'x'.repeat(4001) });
    assert.equal(tooLong.status, 400);
  });

  it('GET /admin/comments aggregates only users with non-empty comments', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'note for x' });
    const list = await adminReq(app, 'GET', '/admin/comments');
    const data = await list.json();
    assert.equal(data.usr_x?.text, 'note for x');
    assert.equal(data.usr_y, undefined, 'users without comments not in the map');
  });

  it('writes are isolated per user (each comment is its own record)', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'note for x' });
    await adminReq(app, 'PUT', '/admin/comments/usr_y', { text: 'note for y' });

    const xRec = await store.getSyncData('usr_x', 'userMeta:teacher-comments');
    const yRec = await store.getSyncData('usr_y', 'userMeta:teacher-comments');
    assert.equal(xRec.data.text, 'note for x');
    assert.equal(yRec.data.text, 'note for y');
    // Updating x doesn't bump y's version (proves no shared record contention).
    const yVerBefore = yRec.version;
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'updated for x' });
    const yAfter = await store.getSyncData('usr_y', 'userMeta:teacher-comments');
    assert.equal(yAfter.version, yVerBefore);
  });

  it('DELETE removes a comment', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'to delete' });
    const res = await adminReq(app, 'DELETE', '/admin/comments/usr_x');
    assert.equal(res.status, 200);
    const list = await adminReq(app, 'GET', '/admin/comments');
    assert.deepEqual(await list.json(), {});
  });
});
