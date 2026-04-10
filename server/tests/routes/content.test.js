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

describe('GET /v1/lessons — visibility filtering', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  const lessons = [
    { dataKey: 'lesson:pub-1', data: { name: 'Public Lesson', markdown: '# P', status: 'public' }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:priv-1', data: { name: 'Private Shared', markdown: '# PS', status: 'private', sharedWith: ['usr_1', 'usr_3'] }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:priv-2', data: { name: 'Private Other', markdown: '# PO', status: 'private', sharedWith: ['usr_2'] }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:priv-3', data: { name: 'Private No Share', markdown: '# PN', status: 'private' }, updatedAt: '2025-01-01' },
  ];

  it('returns public lessons and private lessons shared with user', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    const ids = data.map(l => l.lessonId);
    assert.ok(ids.includes('pub-1'), 'should include public');
    assert.ok(ids.includes('priv-1'), 'should include private shared with user');
    assert.ok(!ids.includes('priv-2'), 'should exclude private not shared with user');
    assert.ok(!ids.includes('priv-3'), 'should exclude private with no sharedWith');
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

  it('shows only public for user not in any sharedWith', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_99');
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].lessonId, 'pub-1');
  });

  it('normalizes legacy "published" status as public', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'lesson:legacy', data: { name: 'Legacy', markdown: '# L', status: 'published' }, updatedAt: '2025-01-01' },
    ];
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_99');
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].lessonId, 'legacy');
  });

  it('normalizes legacy "draft" status as private', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'lesson:old-draft', data: { name: 'Old Draft', markdown: '# D', status: 'draft', sharedWith: ['usr_1'] }, updatedAt: '2025-01-01' },
    ];
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].lessonId, 'old-draft');
  });
});

describe('GET /v1/lessons/:lessonId — access control', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  it('returns public lesson to any user', async () => {
    db.getSyncData = async () => ({ data: { name: 'Public', status: 'public', markdown: '# P' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/pub-1');
    assert.equal(res.status, 200);
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
    assert.equal(data.sharedWith, undefined, 'sharedWith should be stripped');
  });
});
