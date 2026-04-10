import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import content from '../../src/routes/content.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

async function userReq(app, method, path, userId = 'usr_1') {
  const token = await signAccessToken(userId, 'user');
  return app.request(path, {
    method,
    headers: { 'Authorization': 'Bearer ' + token },
  });
}

describe('GET /v1/lessons — private lesson visibility', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  const lessons = [
    { dataKey: 'lesson:pub-1', data: { name: 'Public', markdown: '# P', status: 'published' }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:draft-1', data: { name: 'Draft', markdown: '# D', status: 'draft' }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:priv-1', data: { name: 'Private Shared', markdown: '# PS', status: 'private', sharedWith: ['usr_1', 'usr_3'] }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:priv-2', data: { name: 'Private Other', markdown: '# PO', status: 'private', sharedWith: ['usr_2'] }, updatedAt: '2025-01-01' },
  ];

  it('returns published lessons and private lessons shared with user', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    const ids = data.map(l => l.lessonId);
    assert.ok(ids.includes('pub-1'), 'should include published');
    assert.ok(ids.includes('priv-1'), 'should include private shared with user');
    assert.ok(!ids.includes('draft-1'), 'should exclude drafts');
    assert.ok(!ids.includes('priv-2'), 'should exclude private not shared with user');
  });

  it('strips sharedWith from response', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    const data = await res.json();
    const priv = data.find(l => l.lessonId === 'priv-1');
    assert.ok(priv, 'private lesson should be in response');
    assert.equal(priv.sharedWith, undefined, 'sharedWith should be stripped');
  });

  it('excludes all private lessons for user not in any sharedWith', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_99');
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].lessonId, 'pub-1');
  });
});

describe('GET /v1/lessons/:lessonId — private lesson access', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  it('returns 404 for draft lesson', async () => {
    db.getSyncData = async () => ({ data: { name: 'Draft', status: 'draft', markdown: '# D' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/draft-1');
    assert.equal(res.status, 404);
  });

  it('returns 404 for private lesson when user not in sharedWith', async () => {
    db.getSyncData = async () => ({ data: { name: 'Private', status: 'private', sharedWith: ['usr_2'], markdown: '# P' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/priv-1', 'usr_99');
    assert.equal(res.status, 404);
  });

  it('returns private lesson when user is in sharedWith', async () => {
    db.getSyncData = async () => ({ data: { name: 'Private', status: 'private', sharedWith: ['usr_1'], markdown: '# P' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/priv-1', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Private');
    assert.equal(data.sharedWith, undefined, 'sharedWith should be stripped');
  });

  it('returns published lesson normally', async () => {
    db.getSyncData = async () => ({ data: { name: 'Public', status: 'published', markdown: '# P' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/pub-1');
    assert.equal(res.status, 200);
  });
});
