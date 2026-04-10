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

describe('GET /v1/lessons — shared lesson visibility', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  const lessons = [
    { dataKey: 'lesson:pub-1', data: { name: 'Public', markdown: '# P', status: 'published' }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:draft-1', data: { name: 'Draft Unshared', markdown: '# D', status: 'draft' }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:draft-shared', data: { name: 'Draft Shared', markdown: '# DS', status: 'draft', sharedWith: ['usr_1', 'usr_3'] }, updatedAt: '2025-01-01' },
    { dataKey: 'lesson:draft-other', data: { name: 'Draft Other', markdown: '# DO', status: 'draft', sharedWith: ['usr_2'] }, updatedAt: '2025-01-01' },
  ];

  it('returns published lessons and draft lessons shared with user', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    const ids = data.map(l => l.lessonId);
    assert.ok(ids.includes('pub-1'), 'should include published');
    assert.ok(ids.includes('draft-shared'), 'should include draft shared with user');
    assert.ok(!ids.includes('draft-1'), 'should exclude unshared drafts');
    assert.ok(!ids.includes('draft-other'), 'should exclude draft shared with other user');
  });

  it('strips sharedWith from response', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    const data = await res.json();
    const shared = data.find(l => l.lessonId === 'draft-shared');
    assert.ok(shared, 'shared draft should be in response');
    assert.equal(shared.sharedWith, undefined, 'sharedWith should be stripped');
  });

  it('excludes all drafts for user not in any sharedWith', async () => {
    db.getAllSyncData = async () => lessons;
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_99');
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].lessonId, 'pub-1');
  });
});

describe('GET /v1/lessons/:lessonId — shared lesson access', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  it('returns 404 for unshared draft lesson', async () => {
    db.getSyncData = async () => ({ data: { name: 'Draft', status: 'draft', markdown: '# D' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/draft-1');
    assert.equal(res.status, 404);
  });

  it('returns 404 for draft lesson when user not in sharedWith', async () => {
    db.getSyncData = async () => ({ data: { name: 'Draft Shared', status: 'draft', sharedWith: ['usr_2'], markdown: '# D' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/draft-1', 'usr_99');
    assert.equal(res.status, 404);
  });

  it('returns draft lesson when user is in sharedWith', async () => {
    db.getSyncData = async () => ({ data: { name: 'Draft Shared', status: 'draft', sharedWith: ['usr_1'], markdown: '# D' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/draft-1', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Draft Shared');
    assert.equal(data.sharedWith, undefined, 'sharedWith should be stripped');
  });

  it('returns published lesson normally', async () => {
    db.getSyncData = async () => ({ data: { name: 'Public', status: 'published', markdown: '# P' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/pub-1');
    assert.equal(res.status, 200);
  });
});
