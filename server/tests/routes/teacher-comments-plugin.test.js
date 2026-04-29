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

function fakeUserSyncStore(seed = []) {
  const store = new Map();
  for (const [u, k, v] of seed) store.set(`${u}\0${k}`, { data: v, version: 1 });
  const k = (u, key) => `${u}\0${key}`;
  return {
    getSyncData: async (u, key) => store.get(k(u, key)) || null,
    putSyncData: async (u, key, data, expectedVersion) => {
      const cur = store.get(k(u, key));
      const ver = cur?.version || 0;
      if (expectedVersion !== ver) {
        const err = new Error('conflict'); err.name = 'ConditionalCheckFailedException'; throw err;
      }
      const next = { data, version: ver + 1 };
      store.set(k(u, key), next);
      return next;
    },
    deleteSyncData: async (u, key) => { store.delete(k(u, key)); },
    _peek: () => store,
  };
}

describe('teacher-comments — thread API', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Alice Admin' };
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
    const res = await userReq(app, 'GET', '/admin/comments/usr_x');
    assert.equal(res.status, 403);
  });

  it('GET on a user with no comments returns an empty thread', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const res = await adminReq(app, 'GET', '/admin/comments/usr_x');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { comments: [] });
  });

  it('POST appends a comment with author + timestamp; GET returns it newest-first', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();

    const post1 = await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'first' });
    assert.equal(post1.status, 201);
    const c1 = await post1.json();
    assert.equal(c1.text, 'first');
    assert.equal(c1.authorId, 'usr_admin');
    assert.equal(c1.authorName, 'Alice Admin');
    assert.ok(c1.id);
    assert.ok(c1.createdAt);

    // small wait so the second timestamp is strictly later
    await new Promise((r) => setTimeout(r, 5));
    const post2 = await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'second' });
    assert.equal(post2.status, 201);

    const list = await adminReq(app, 'GET', '/admin/comments/usr_x');
    const data = await list.json();
    assert.equal(data.comments.length, 2);
    assert.equal(data.comments[0].text, 'second', 'newest first');
    assert.equal(data.comments[1].text, 'first');
  });

  it('POST validates body (empty, missing, oversize, wrong type)', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    assert.equal((await adminReq(app, 'POST', '/admin/comments/usr_x', { text: '   ' })).status, 400);
    assert.equal((await adminReq(app, 'POST', '/admin/comments/usr_x', {})).status, 400);
    assert.equal((await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 42 })).status, 400);
    assert.equal((await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'x'.repeat(4001) })).status, 400);
  });

  it('DELETE removes a single comment without affecting others', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const c1 = await (await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'one' })).json();
    await new Promise((r) => setTimeout(r, 5));
    const c2 = await (await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'two' })).json();
    const del = await adminReq(app, 'DELETE', `/admin/comments/usr_x/${c1.id}`);
    assert.equal(del.status, 200);
    const list = await (await adminReq(app, 'GET', '/admin/comments/usr_x')).json();
    assert.equal(list.comments.length, 1);
    assert.equal(list.comments[0].id, c2.id);
  });

  it('DELETE on the last comment removes the userMeta record entirely', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const c1 = await (await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'only' })).json();
    await adminReq(app, 'DELETE', `/admin/comments/usr_x/${c1.id}`);
    assert.equal(store._peek().has('usr_x\0userMeta:teacher-comments'), false);
  });

  it('DELETE returns 404 for unknown comment id', async () => {
    const store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    await adminReq(app, 'POST', '/admin/comments/usr_x', { text: 'one' });
    const res = await adminReq(app, 'DELETE', '/admin/comments/usr_x/cm_doesnotexist');
    assert.equal(res.status, 404);
  });

  it('reads tolerate the legacy single-comment shape', async () => {
    const store = fakeUserSyncStore([
      ['usr_x', 'userMeta:teacher-comments', {
        text: 'pre-thread comment from the old API',
        updatedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'usr_admin',
      }],
    ]);
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
    const app = buildApp();
    const list = await (await adminReq(app, 'GET', '/admin/comments/usr_x')).json();
    assert.equal(list.comments.length, 1);
    assert.equal(list.comments[0].text, 'pre-thread comment from the old API');
    assert.equal(list.comments[0].createdAt, '2026-01-01T00:00:00.000Z');
    assert.match(list.comments[0].id, /^cm_legacy_/);
  });

});
