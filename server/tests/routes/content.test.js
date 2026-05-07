import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import content, { _resetTimeStatsCache } from '../../src/routes/content.js';
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

  it('hides true drafts (status=draft, no markdown) from learners even when shared', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'lesson:draft-1', data: { name: 'Untitled draft', markdown: '', status: 'draft', sharedWith: ['usr_1'] }, updatedAt: '2026-04-22' },
      { dataKey: 'lesson:pub-1', data: { name: 'Public', markdown: '# P', status: 'public' }, updatedAt: '2025-01-01' },
    ];
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    const data = await res.json();
    const ids = data.map(l => l.lessonId);
    assert.ok(!ids.includes('draft-1'), 'drafts must not appear in learner lesson list');
    assert.ok(ids.includes('pub-1'));
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

  it('returns 404 for drafts even when shared', async () => {
    db.getSyncData = async () => ({
      data: { name: 'Untitled draft', status: 'draft', markdown: '', sharedWith: ['usr_1'] },
      version: 1,
    });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/draft-1', 'usr_1');
    assert.equal(res.status, 404);
  });
});

describe('GET /v1/lessons/time-stats', () => {
  // Counts under 3 are dropped (need a minimum sample). For pub-1: [4,6,8,10,12,14,16,18]
  // p20Idx = floor(8 * 0.2) = 1 → 6; p80Idx = floor(8 * 0.8) = 6 → 16. So {p20:6, p80:16}.
  const completionExchanges = {
    'pub-1': [4, 6, 8, 10, 12, 14, 16, 18],
    'priv-1': [10, 11, 12], // shared with usr_1 only
    'too-few': [5, 7],      // <3 completions, omitted
  };

  function buildKbItems() {
    const items = [];
    let userIdx = 0;
    for (const [lessonId, counts] of Object.entries(completionExchanges)) {
      for (const exchanges of counts) {
        items.push({
          userId: `learner-${userIdx++}`,
          dataKey: `lessonKB:${lessonId}`,
          data: { status: 'completed', activitiesCompleted: exchanges },
        });
      }
    }
    // Mixed in: an in-progress KB and a completed-but-zero record that must be ignored.
    items.push({ userId: 'learner-x', dataKey: 'lessonKB:pub-1', data: { status: 'in_progress', activitiesCompleted: 5 } });
    items.push({ userId: 'learner-y', dataKey: 'lessonKB:pub-1', data: { status: 'completed', activitiesCompleted: 0 } });
    return items;
  }

  beforeEach(() => {
    _resetTimeStatsCache();
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
    const allKbItems = buildKbItems();
    const userIds = [...new Set(allKbItems.map(i => i.userId))];
    db.listAllUsers = async () => userIds.map(uid => ({ userId: uid, role: 'user' }));
    db.getAllSyncData = async (uid) => {
      if (uid === '_system') {
        return [
          { dataKey: 'lesson:pub-1', data: { name: 'Public', markdown: '# P', status: 'public' } },
          { dataKey: 'lesson:priv-1', data: { name: 'Private Shared', markdown: '# PS', status: 'private', sharedWith: ['usr_1'] } },
          { dataKey: 'lesson:too-few', data: { name: 'New Lesson', markdown: '# N', status: 'public' } },
        ];
      }
      return allKbItems.filter(i => i.userId === uid);
    };
  });

  it('returns p20/p80/sampleSize for lessons with >=3 completions, visible to user', async () => {
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/time-stats', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data['pub-1'], { p20: 6, p80: 16, sampleSize: 8 });
    assert.deepEqual(data['priv-1'], { p20: 10, p80: 12, sampleSize: 3 });
    assert.equal(data['too-few'], undefined, 'lessons with <3 completions are omitted');
  });

  it('omits private lessons not shared with the user', async () => {
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/time-stats', 'usr_99');
    const data = await res.json();
    assert.ok(data['pub-1'], 'public lesson stats included for any user');
    assert.equal(data['priv-1'], undefined, 'private lesson hidden from non-shared user');
  });

  it('does not eclipse /v1/lessons/:lessonId routing (route order)', async () => {
    db.getSyncData = async () => ({ data: { name: 'Public', status: 'public', markdown: '# P' }, version: 1 });
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/some-real-lesson');
    assert.equal(res.status, 200);
  });
});

describe('Course inlining on lesson endpoints', () => {
  beforeEach(() => {
    db.getUserById = async (id) => ({ userId: id, role: 'user', name: 'User' });
  });

  const buildItems = () => ([
    { dataKey: 'course:c-1', data: { name: 'AI Foundations' }, updatedAt: '2026-01-01' },
    { dataKey: 'lesson:l-with-course', data: { name: 'Lesson A', markdown: '# A', status: 'public', course: 'c-1' }, updatedAt: '2026-01-02' },
    { dataKey: 'lesson:l-no-course', data: { name: 'Lesson B', markdown: '# B', status: 'public' }, updatedAt: '2026-01-02' },
    { dataKey: 'lesson:l-orphan', data: { name: 'Lesson C', markdown: '# C', status: 'public', course: 'c-deleted' }, updatedAt: '2026-01-02' },
  ]);

  it('GET /v1/lessons inlines course as { id, name }', async () => {
    db.getAllSyncData = async () => buildItems();
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    assert.equal(res.status, 200);
    const data = await res.json();
    const withCourse = data.find(l => l.lessonId === 'l-with-course');
    assert.deepEqual(withCourse.course, { id: 'c-1', name: 'AI Foundations' });
  });

  it('GET /v1/lessons sets course to null when lesson has no course', async () => {
    db.getAllSyncData = async () => buildItems();
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    const data = await res.json();
    const noCourse = data.find(l => l.lessonId === 'l-no-course');
    assert.equal(noCourse.course, null);
  });

  it('GET /v1/lessons sets course to null when the referenced course was deleted', async () => {
    db.getAllSyncData = async () => buildItems();
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons', 'usr_1');
    const data = await res.json();
    const orphan = data.find(l => l.lessonId === 'l-orphan');
    assert.equal(orphan.course, null);
  });

  it('GET /v1/lessons/:id inlines course on a single lesson', async () => {
    db.getSyncData = async (uid, key) => {
      if (key === 'lesson:l-1') return { data: { name: 'L', markdown: '# L', status: 'public', course: 'c-1' }, version: 1 };
      if (key === 'course:c-1') return { data: { name: 'AI Foundations' }, version: 1 };
      return null;
    };
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/l-1');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.course, { id: 'c-1', name: 'AI Foundations' });
  });

  it('GET /v1/lessons/:id returns course=null when course was deleted', async () => {
    db.getSyncData = async (uid, key) => {
      if (key === 'lesson:l-1') return { data: { name: 'L', markdown: '# L', status: 'public', course: 'c-gone' }, version: 1 };
      return null; // course not found
    };
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/l-1');
    const data = await res.json();
    assert.equal(data.course, null);
  });

  it('GET /v1/lessons/:id returns course=null when lesson has no course', async () => {
    db.getSyncData = async (uid, key) => {
      if (key === 'lesson:l-1') return { data: { name: 'L', markdown: '# L', status: 'public' }, version: 1 };
      return null;
    };
    const app = new Hono(); app.route('/', content);
    const res = await userReq(app, 'GET', '/v1/lessons/l-1');
    const data = await res.json();
    assert.equal(data.course, null);
  });
});
