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

// Tiny in-memory store for `_system:plugins:activation` so tests don't need a DB.
function fakeStore(initial = {}) {
  let data = { ...initial };
  let version = 0;
  return {
    getSyncData: async (userId, key) => {
      if (userId !== '_system' || key !== 'plugins:activation') return null;
      return { data, version };
    },
    putSyncData: async (userId, key, next, expectedVersion) => {
      if (userId !== '_system' || key !== 'plugins:activation') throw new Error('unexpected key');
      if (expectedVersion !== version) {
        const err = new Error('version conflict');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      data = next;
      version += 1;
      return { version };
    },
    _peek: () => ({ data, version }),
  };
}

describe('teacher-comments plugin', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
  });

  it('rejects non-admin', async () => {
    const app = buildApp();
    const res = await userReq(app, 'GET', '/admin/comments');
    assert.equal(res.status, 403);
  });

  it('GET /admin/comments returns empty map by default', async () => {
    const store = fakeStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    const res = await adminReq(app, 'GET', '/admin/comments');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {});
  });

  it('PUT then GET round-trips a comment', async () => {
    const store = fakeStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    const put = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'Strong reasoner.' });
    assert.equal(put.status, 200);
    const get = await adminReq(app, 'GET', '/admin/comments/usr_x');
    assert.equal(get.status, 200);
    const data = await get.json();
    assert.equal(data.text, 'Strong reasoner.');
    assert.equal(data.updatedBy, 'usr_admin');
    assert.ok(data.updatedAt);
  });

  it('PUT with empty text deletes the entry', async () => {
    const store = fakeStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'temporary' });
    const del = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: '' });
    assert.equal(del.status, 200);
    const list = await adminReq(app, 'GET', '/admin/comments');
    assert.deepEqual(await list.json(), {});
  });

  it('PUT validates text type', async () => {
    const store = fakeStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    const res = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 12345 });
    assert.equal(res.status, 400);
  });

  it('PUT enforces 4000 char cap', async () => {
    const store = fakeStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    const res = await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'x'.repeat(4001) });
    assert.equal(res.status, 400);
  });

  it('preserves other plugins\' settings on the activation record', async () => {
    // Pre-seed the store with another plugin's data — make sure teacher-comments
    // writes don't clobber it.
    const store = fakeStore({
      slack: { enabled: true, settings: { workspaceName: 'Acme', connected: true } },
    });
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'note' });
    const after = store._peek();
    assert.equal(after.data.slack?.settings?.workspaceName, 'Acme', 'slack settings clobbered');
    assert.equal(after.data['teacher-comments']?.settings?.comments?.usr_x?.text, 'note');
  });

  it('DELETE removes a comment', async () => {
    const store = fakeStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    const app = buildApp();
    await adminReq(app, 'PUT', '/admin/comments/usr_x', { text: 'to delete' });
    const res = await adminReq(app, 'DELETE', '/admin/comments/usr_x');
    assert.equal(res.status, 200);
    const list = await adminReq(app, 'GET', '/admin/comments');
    assert.deepEqual(await list.json(), {});
  });
});
