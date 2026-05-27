import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { logger } from '../../src/lib/logger.js';

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

describe('GET /v1/admin/users', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
  });

  it('returns user list for admin', async () => {
    db.listAllUsers = async () => [
      { userId: 'usr_1', email: 'a@x.com', name: 'A', userGroup: null, role: 'user', createdAt: '2024-01-01' },
    ];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].email, 'a@x.com');
  });

  it('rejects non-admin', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await userReq(app, 'GET', '/v1/admin/users');
    assert.equal(res.status, 403);
  });
});

describe('POST /v1/admin/impersonation/start + end', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', email: 'admin@x.com', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      if (id === 'usr_target') return { userId: 'usr_target', email: 't@x.com', username: 'target', name: 'Target', role: 'user' };
      return null;
    };
  });

  it('start writes audit_log entry with action=admin_view_as_user_started', async () => {
    let logged = null;
    db.createAuditLog = async (entry) => { logged = entry; };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/impersonation/start', { targetUserId: 'usr_target' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.userId, 'usr_target');
    assert.equal(body.username, 'target');
    assert.equal(logged?.action, 'admin_view_as_user_started');
    assert.equal(logged?.userId, 'usr_target');
    assert.equal(logged?.performedBy, 'usr_admin');
  });

  it('start returns 404 when target does not exist', async () => {
    db.createAuditLog = async () => {};
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/impersonation/start', { targetUserId: 'usr_nope' });
    assert.equal(res.status, 404);
  });

  it('start returns 400 when targetUserId missing', async () => {
    db.createAuditLog = async () => {};
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/impersonation/start', {});
    assert.equal(res.status, 400);
  });

  it('start rejects non-admins', async () => {
    db.createAuditLog = async () => {};
    const app = new Hono();
    app.route('/', admin);
    const res = await userReq(app, 'POST', '/v1/admin/impersonation/start', { targetUserId: 'usr_target' });
    assert.equal(res.status, 403);
  });

  it('end writes audit_log entry with action=admin_view_as_user_ended', async () => {
    let logged = null;
    db.createAuditLog = async (entry) => { logged = entry; };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/impersonation/end', { targetUserId: 'usr_target' });
    assert.equal(res.status, 200);
    assert.equal(logged?.action, 'admin_view_as_user_ended');
    assert.equal(logged?.performedBy, 'usr_admin');
  });

  it('end is best-effort when targetUserId is missing', async () => {
    let logged = null;
    db.createAuditLog = async (entry) => { logged = entry; };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/impersonation/end', {});
    assert.equal(res.status, 200);
    assert.equal(logged?.action, 'admin_view_as_user_ended');
  });
});

describe('POST /v1/admin/invites', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    db.createInvite = async () => {};
  });

  it('creates invite', async () => {
    // Since we can't easily mock SES in this test, we set SKIP_EMAIL
    process.env.SKIP_EMAIL = 'true';
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites', { email: 'new@example.com' });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.inviteToken);
    assert.equal(data.email, 'new@example.com');
    delete process.env.SKIP_EMAIL;
  });

  it('rejects existing email', async () => {
    db.getUserByEmail = async () => ({ userId: 'usr_existing' });
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites', { email: 'existing@example.com' });
    assert.equal(res.status, 409);
  });
});

describe('POST /v1/admin/invites/bulk', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    db.createInvite = async () => {};
    process.env.SKIP_EMAIL = 'true';
  });

  afterEach(() => {
    delete process.env.SKIP_EMAIL;
  });

  it('sends multiple invites', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {
      emails: ['a@example.com', 'b@example.com'],
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sent, 2);
    assert.equal(data.skipped, 0);
    assert.equal(data.total, 2);
  });

  it('skips existing users', async () => {
    db.getUserByEmail = async (email) => email === 'exists@example.com' ? { userId: 'usr_x' } : null;
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {
      emails: ['exists@example.com', 'new@example.com'],
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sent, 1);
    assert.equal(data.skipped, 1);
    assert.equal(data.results[0].status, 'skipped');
    assert.equal(data.results[1].status, 'sent');
  });

  it('rejects invalid emails', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {
      emails: ['not-an-email', 'valid@example.com'],
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.sent, 1);
    assert.equal(data.skipped, 1);
    assert.equal(data.results[0].status, 'invalid');
  });

  it('rejects empty array', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', { emails: [] });
    assert.equal(res.status, 400);
  });

  it('rejects missing emails field', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/invites/bulk', {});
    assert.equal(res.status, 400);
  });
});

describe('GET /v1/invite-example.csv', () => {
  it('returns CSV with example emails (no auth required)', async () => {
    const { default: appRoutes } = await import('../../src/routes/app.js');
    const app = new Hono();
    app.route('/', appRoutes);
    const res = await app.request('/v1/invite-example.csv');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.startsWith('email'));
    assert.ok(text.includes('jane@example.com'));
    assert.equal(res.headers.get('Content-Type'), 'text/csv');
  });
});

describe('PUT /v1/admin/lessons/:lessonId — objective validation', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getSyncData = async () => null;
    db.putSyncData = async () => {};
  });

  const validMarkdown = `# Test Lesson

A test lesson.

## Exemplar
Produce a thing.

## Learning Objectives
- Can do thing one
- Can do thing two
- Can do thing three`;

  it('accepts 2-4 objectives', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-1', {
      markdown: validMarkdown, name: 'Test Lesson',
    });
    assert.equal(res.status, 200);
  });

  it('rejects too many objectives', async () => {
    const md = validMarkdown + '\n- Can do thing four\n- Can do thing five';
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-1', {
      markdown: md, name: 'Test Lesson',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Too many objectives'));
  });

  it('rejects too few objectives', async () => {
    const md = `# Test Lesson

A test.

## Exemplar
Produce a thing.

## Learning Objectives
- Can do one thing`;
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-1', {
      markdown: md, name: 'Test Lesson',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Too few objectives'));
  });
});

describe('PUT /v1/admin/lessons/:lessonId/conversation — auto-save', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  });

  it('saves conversation to existing lesson without touching markdown', async () => {
    const existing = { markdown: '# Test\n\nDesc\n\n## Exemplar\n\nDo it\n\n## Learning Objectives\n\n- Can do A\n- Can do B', name: 'Test', status: 'published' };
    db.getSyncData = async () => ({ data: existing, version: 1 });
    let savedData;
    db.putSyncData = async (uid, key, data) => { savedData = data; };
    const app = new Hono(); app.route('/', admin);
    const convo = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test/conversation', { conversation: convo, readiness: 5 });
    assert.equal(res.status, 200);
    assert.deepEqual(savedData.conversation, convo);
    assert.equal(savedData.readiness, 5);
    assert.equal(savedData.markdown, existing.markdown, 'markdown must not be modified');
    assert.equal(savedData.status, 'published', 'status must not be modified');
  });

  it('returns 404 for non-existent lesson', async () => {
    db.getSyncData = async () => null;
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/nope/conversation', { conversation: [] });
    assert.equal(res.status, 404);
  });
});

describe('draft lesson records', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  });

  it('accepts PUT with status=draft and no markdown', async () => {
    let stored = null;
    db.getSyncData = async () => stored ? { data: stored, version: 1 } : null;
    db.putSyncData = async (uid, key, data) => { stored = data; };
    const app = new Hono(); app.route('/', admin);
    const convo = [{ role: 'user', content: 'teach me' }, { role: 'assistant', content: 'sure' }];
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/draft-123', {
      status: 'draft', name: 'Untitled draft', conversation: convo, readiness: 2,
    });
    assert.equal(res.status, 200);
    assert.equal(stored.status, 'draft');
    assert.equal(stored.markdown, '');
    assert.deepEqual(stored.conversation, convo);
    assert.equal(stored.readiness, 2);
  });

  it('rejects PUT without markdown when status is not draft', async () => {
    db.getSyncData = async () => null;
    db.putSyncData = async () => {};
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/no-md', {
      name: 'Missing Markdown',
    });
    assert.equal(res.status, 400);
  });

  it('validates markdown when a draft is finalized to private', async () => {
    db.getSyncData = async () => ({
      data: { status: 'draft', markdown: '', conversation: [], name: 'Untitled draft' },
      version: 1,
    });
    db.putSyncData = async () => {};
    const badMd = `# Bad\n\n## Exemplar\nDo it\n\n## Learning Objectives\n- Can do one`;
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/draft-123', {
      markdown: badMd, status: 'private',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Too few objectives'));
  });

  it('lists drafts in admin lessons with status=draft', async () => {
    db.getAllSyncData = async () => [{
      dataKey: 'lesson:draft-1',
      data: { name: 'Untitled draft', status: 'draft', markdown: '', conversation: [] },
      updatedAt: '2026-04-22',
    }];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/lessons');
    const data = await res.json();
    assert.equal(data[0].status, 'draft');
  });
});

describe('GET /v1/admin/stats/lessons', () => {
  // Stats endpoint is wrapped in a stale-while-revalidate cache stored in
  // `_system:stats:lessons`. By default each test mocks an empty cache so the
  // compute path runs synchronously; the cache-behavior tests override.
  let putCalls;
  beforeEach(() => {
    putCalls = [];
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getSyncData = async () => null;
    db.putSyncData = async (userId, dataKey, data) => { putCalls.push({ userId, dataKey, data }); };
  });

  it('returns aggregated lesson stats', async () => {
    db.listAllUsers = async () => [
      { userId: 'u1', role: 'user' }, { userId: 'u2', role: 'user' }, { userId: 'u3', role: 'user' },
    ];
    db.getAllSyncData = async (userId) => {
      if (userId === '_system') return [
        { dataKey: 'lesson:c1', data: { status: 'public', markdown: '# C1' } },
        { dataKey: 'lesson:c2', data: { status: 'public', markdown: '# C2' } },
      ];
      if (userId === 'u1') return [
        { dataKey: 'lessonKB:c1', data: { status: 'completed', progress: 10, activitiesCompleted: 6, startedAt: 1000000, completedAt: 1600000 } },
        { dataKey: 'lessonKB:c2', data: { status: 'active', progress: 4, activitiesCompleted: 3 } },
        { dataKey: 'profile', data: {} },
      ];
      if (userId === 'u2') return [
        { dataKey: 'lessonKB:c1', data: { status: 'completed', progress: 10, activitiesCompleted: 15, startedAt: 1000000, completedAt: 2200000 } },
      ];
      // u3: extended lesson (22 exchanges — past 2× target, still counts as completion)
      return [
        { dataKey: 'lessonKB:c1', data: { status: 'completed', progress: 10, activitiesCompleted: 22, startedAt: 1000000, completedAt: 2800000 } },
      ];
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.totalCompletions, 3);
    assert.equal(data.withinTarget, 1);
    assert.equal(data.overTarget, 2); // 15 exch + 22 exch both count as over-target
    assert.equal(data.extendedLessons, 1); // subset of overTarget: the 22-exchange one
    assert.equal(data.activeLessons, 1);
    assert.equal(data.avgExchangesWithinTarget, 6);
    assert.equal(data.exchangeTarget, 11);
    assert.equal(data.extendedThreshold, 22);
    assert.equal(data.avgDurationMinutes, 20);
    // Cache write happened
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].userId, '_system');
    assert.equal(putCalls[0].dataKey, 'stats:lessons');
  });

  it('returns nulls when no completions', async () => {
    db.listAllUsers = async () => [];
    db.getAllSyncData = async () => [];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.totalCompletions, 0);
    assert.equal(data.avgExchangesPerCompletion, null);
  });

  it('computes engagement KPIs (started + completed-half), excluding admins from the denominator', async () => {
    db.listAllUsers = async () => [
      { userId: 'u1', role: 'user' },      // started + completed 2/2 -> counts as "completed half+"
      { userId: 'u2', role: 'user' },      // started, completed 0/2 -> started only
      { userId: 'u3', role: 'user' },      // not started
      { userId: 'a1', role: 'admin' },     // admin: excluded from denominator
    ];
    db.getAllSyncData = async (userId) => {
      if (userId === '_system') return [
        { dataKey: 'lesson:L1', data: { status: 'public', markdown: '...' } },
        { dataKey: 'lesson:L2', data: { status: 'public', markdown: '...' } },
      ];
      if (userId === 'u1') return [
        { dataKey: 'lessonKB:L1', data: { status: 'completed', activitiesCompleted: 5 } },
        { dataKey: 'lessonKB:L2', data: { status: 'completed', activitiesCompleted: 5 } },
      ];
      if (userId === 'u2') return [
        { dataKey: 'lessonKB:L1', data: { status: 'active', activitiesCompleted: 1 } },
      ];
      return []; // u3, a1
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.activeLearners, 3); // admins excluded
    assert.equal(data.learnersStarted, 2); // u1, u2
    assert.equal(data.learnersCompletedHalf, 1); // u1 (2/2 > 50%)
    assert.equal(data.pctStarted, 66.7);
    assert.equal(data.pctCompletedHalf, 33.3);
    assert.equal(data.targetStartedPct, 90);
    assert.equal(data.targetCompletedHalfPct, 50);
  });

  it('exactly-50% does NOT count as completed-half (rule is > 50%)', async () => {
    db.listAllUsers = async () => [
      { userId: 'u1', role: 'user' }, // 1/2 completed = 50% — NOT > 50%
      { userId: 'u2', role: 'user' }, // 2/3 completed = 66.7% — counts
    ];
    db.getAllSyncData = async (userId) => {
      if (userId === '_system') return [
        { dataKey: 'lesson:L1', data: { status: 'public', markdown: '...' } },
        { dataKey: 'lesson:L2', data: { status: 'public', markdown: '...' } },
        { dataKey: 'lesson:L3', data: { status: 'public', markdown: '...' } },
      ];
      if (userId === 'u1') return [
        { dataKey: 'lessonKB:L1', data: { status: 'completed', activitiesCompleted: 5 } },
      ];
      if (userId === 'u2') return [
        { dataKey: 'lessonKB:L1', data: { status: 'completed', activitiesCompleted: 5 } },
        { dataKey: 'lessonKB:L2', data: { status: 'completed', activitiesCompleted: 5 } },
      ];
      return [];
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    const data = await res.json();
    assert.equal(data.learnersCompletedHalf, 1); // u2 only
  });

  it('counts only published lessons — private, draft, and custom completions are excluded', async () => {
    db.listAllUsers = async () => [{ userId: 'u1', role: 'user' }];
    db.getAllSyncData = async (userId) => {
      if (userId === '_system') return [
        { dataKey: 'lesson:pub', data: { status: 'public', markdown: '# Public' } },
        { dataKey: 'lesson:priv', data: { status: 'private', markdown: '# Private', sharedWith: ['u1'] } },
        { dataKey: 'lesson:draft', data: { status: 'draft', markdown: '' } },
      ];
      // u1 completed one of each kind + a self-authored custom lesson (no
      // `_system:lesson:*` record). Only the public completion should count.
      return [
        { dataKey: 'lessonKB:pub', data: { status: 'completed', activitiesCompleted: 5 } },
        { dataKey: 'lessonKB:priv', data: { status: 'completed', activitiesCompleted: 5 } },
        { dataKey: 'lessonKB:draft', data: { status: 'completed', activitiesCompleted: 5 } },
        { dataKey: 'lessonKB:custom-abc', data: { status: 'completed', activitiesCompleted: 5 } },
        { dataKey: 'lessonKB:pub2', data: { status: 'active', activitiesCompleted: 2 } }, // active but not public → ignored
      ];
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    const data = await res.json();
    assert.equal(data.totalCompletions, 1, 'only the public lesson completion counts');
    assert.equal(data.activeLessons, 0, 'active KB for a non-public lesson is ignored');
    assert.equal(data.learnersStarted, 1, 'learner started a public lesson');
    assert.equal(data.learnersCompletedHalf, 1, '1 of 1 public lesson completed > 50%');
  });

  it('serves cached value without recomputing when cache is fresh', async () => {
    const cachedStats = { totalCompletions: 999, fromCache: true };
    db.getSyncData = async (userId, dataKey) => {
      if (userId === '_system' && dataKey === 'stats:lessons') {
        return { data: { computedAt: new Date().toISOString(), stats: cachedStats } };
      }
      return null;
    };
    let computeRan = false;
    db.listAllUsers = async () => { computeRan = true; return []; };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.totalCompletions, 999);
    assert.equal(data.fromCache, true);
    assert.equal(computeRan, false, 'should not have recomputed');
    assert.equal(putCalls.length, 0, 'should not have written cache');
  });

  it('serves cached value and skips synchronous recompute when cache is stale (10min < age < 24h)', async () => {
    const cachedStats = { totalCompletions: 42, fromCache: true };
    const staleAgeMs = 30 * 60 * 1000; // 30 minutes
    db.getSyncData = async () => ({
      data: { computedAt: new Date(Date.now() - staleAgeMs).toISOString(), stats: cachedStats },
    });
    let computeRan = false;
    db.listAllUsers = async () => { computeRan = true; return []; };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.fromCache, true);
    assert.equal(computeRan, false, 'stale path should NOT recompute synchronously');
  });

  it('?refresh=1 bypasses a fresh cache and recomputes', async () => {
    const cachedStats = { totalCompletions: 999, fromCache: true };
    db.getSyncData = async () => ({
      data: { computedAt: new Date().toISOString(), stats: cachedStats },
    });
    let computeRan = false;
    db.listAllUsers = async () => { computeRan = true; return []; };
    db.getAllSyncData = async () => [];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons?refresh=1');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.fromCache, undefined, 'should not return cached payload');
    assert.equal(data.totalCompletions, 0);
    assert.equal(typeof data.computedAt, 'string');
    assert.equal(computeRan, true);
    assert.equal(putCalls.length, 1, 'should have written fresh cache');
  });

  it('returns computedAt inlined in the stats payload', async () => {
    const computedAt = new Date().toISOString();
    db.getSyncData = async () => ({
      data: { computedAt, stats: { totalCompletions: 7 } },
    });
    db.listAllUsers = async () => [];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    const data = await res.json();
    assert.equal(data.computedAt, computedAt);
    assert.equal(data.totalCompletions, 7);
  });

  it('recomputes synchronously when cache is older than MAX_AGE (>24h)', async () => {
    const expiredAgeMs = 25 * 60 * 60 * 1000; // 25 hours
    db.getSyncData = async () => ({
      data: { computedAt: new Date(Date.now() - expiredAgeMs).toISOString(), stats: { stale: true } },
    });
    db.listAllUsers = async () => [];
    db.getAllSyncData = async () => [];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.stale, undefined, 'should not return stale cache');
    assert.equal(data.totalCompletions, 0);
    assert.equal(putCalls.length, 1, 'should have written fresh cache');
  });
});

describe('DELETE /v1/admin/users/:userId', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_p1') return { userId: 'usr_p1', role: 'user', name: 'P1' };
      return null;
    };
    db.deleteUser = async () => {};
  });

  it('deletes user and sync data', async () => {
    let deleted = false;
    db.getAllSyncData = async () => [{ dataKey: 'profile' }, { dataKey: 'work' }];
    db.deleteSyncData = async () => {};
    db.deleteUser = async () => { deleted = true; };
    db.createAuditLog = async () => {};
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'DELETE', '/v1/admin/users/usr_p1');
    assert.equal(res.status, 200);
    assert.ok(deleted);
  });
});

describe('PUT /v1/admin/lessons/:lessonId — sharedWith + public/private', () => {
  const validMarkdown = `# Test Lesson\n\nA test.\n\n## Exemplar\nProduce a thing.\n\n## Learning Objectives\n- Can do A\n- Can do B`;

  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getSyncData = async () => null;
    db.putSyncData = async () => {};
  });

  it('persists sharedWith on a private lesson', async () => {
    let savedData;
    db.putSyncData = async (uid, key, data) => { savedData = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-share', {
      markdown: validMarkdown, name: 'Private Test', status: 'private', sharedWith: ['usr_1', 'usr_2'],
    });
    assert.equal(res.status, 200);
    assert.equal(savedData.status, 'private');
    assert.deepEqual(savedData.sharedWith, ['usr_1', 'usr_2']);
  });

  it('validates markdown when going public', async () => {
    const badMd = `# Test\n\n## Exemplar\nDo it\n\n## Learning Objectives\n- Can do one thing`;
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-share', {
      markdown: badMd, name: 'Bad', status: 'public',
    });
    assert.equal(res.status, 400);
  });

  it('preserves sharedWith when updating status to public', async () => {
    let savedData;
    db.getSyncData = async () => ({
      data: { markdown: validMarkdown, name: 'Test', status: 'private', sharedWith: ['usr_1', 'usr_2'] },
      version: 1,
    });
    db.putSyncData = async (uid, key, data) => { savedData = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-share', { status: 'public' });
    assert.equal(res.status, 200);
    assert.equal(savedData.status, 'public');
    assert.deepEqual(savedData.sharedWith, ['usr_1', 'usr_2']);
  });

  it('allows clearing sharedWith', async () => {
    let savedData;
    db.getSyncData = async () => ({
      data: { markdown: validMarkdown, name: 'Test', status: 'private', sharedWith: ['usr_1'] },
      version: 1,
    });
    db.putSyncData = async (uid, key, data) => { savedData = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-share', { sharedWith: [] });
    assert.equal(res.status, 200);
    assert.deepEqual(savedData.sharedWith, []);
  });

  it('normalizes legacy status=draft records with markdown to private', async () => {
    // A legacy record left behind before drafts became first-class:
    // has markdown, so it is a real lesson and must surface as private, not draft.
    db.getAllSyncData = async () => [{
      dataKey: 'lesson:old-1',
      data: { name: 'Old Draft', status: 'draft', markdown: validMarkdown, sharedWith: ['usr_1'] },
      updatedAt: '2025-01-01',
    }];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/lessons');
    const data = await res.json();
    assert.equal(data[0].status, 'private');
    assert.deepEqual(data[0].sharedWith, ['usr_1']);
  });

  it('returns sharedWith in admin lesson list', async () => {
    db.getAllSyncData = async () => [{
      dataKey: 'lesson:priv-1',
      data: { name: 'Private', status: 'private', sharedWith: ['usr_1', 'usr_2'] },
      updatedAt: '2025-01-01',
    }];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/lessons');
    const data = await res.json();
    assert.equal(data[0].status, 'private');
    assert.deepEqual(data[0].sharedWith, ['usr_1', 'usr_2']);
  });
});

describe('lessons endpoint — updatedByName', () => {
  const validMarkdown = `# Test Lesson\n\nA test.\n\n## Exemplar\nProduce a thing.\n\n## Learning Objectives\n- Can do A\n- Can do B`;

  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin', username: 'admin_user', email: 'admin@example.com' });
    db.getSyncData = async () => null;
    db.putSyncData = async () => {};
  });

  it('PUT persists updatedByName from adminUser.username', async () => {
    let savedData;
    db.putSyncData = async (uid, key, data) => { savedData = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-1', {
      markdown: validMarkdown, name: 'Test',
    });
    assert.equal(res.status, 200);
    assert.equal(savedData.updatedByName, 'admin_user');
  });

  it('PUT falls back to email when username is missing', async () => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', email: 'admin@example.com' });
    let savedData;
    db.putSyncData = async (uid, key, data) => { savedData = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/test-1', {
      markdown: validMarkdown, name: 'Test',
    });
    assert.equal(res.status, 200);
    assert.equal(savedData.updatedByName, 'admin@example.com');
  });

  it('GET list returns updatedByName from data', async () => {
    db.getAllSyncData = async () => [{
      dataKey: 'lesson:upd-1',
      data: { name: 'Updated Lesson', status: 'public', updatedByName: 'alice' },
      updatedAt: '2026-04-20',
    }];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/lessons');
    const data = await res.json();
    assert.equal(data[0].updatedByName, 'alice');
  });

  it('GET list returns null updatedByName when record pre-dates the field', async () => {
    db.getAllSyncData = async () => [{
      dataKey: 'lesson:old-1',
      data: { name: 'Legacy', status: 'public' },
      updatedAt: '2025-01-01',
    }];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/lessons');
    const data = await res.json();
    assert.equal(data[0].updatedByName, null);
  });
});

describe('GET /v1/admin/logs', () => {
  const origConsoleErr = console.error;
  const origConsoleWarn = console.warn;
  let savedRegion;

  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
    logger._reset();
    console.error = () => {};
    console.warn = () => {};
    savedRegion = process.env.AWS_REGION;
    delete process.env.AWS_REGION; // force cloudwatch error path
  });

  afterEach(() => {
    console.error = origConsoleErr;
    console.warn = origConsoleWarn;
    if (savedRegion !== undefined) process.env.AWS_REGION = savedRegion;
  });

  it('rejects non-admin', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await userReq(app, 'GET', '/v1/admin/logs');
    assert.equal(res.status, 403);
  });

  it('returns captured errors from the ring buffer', async () => {
    logger.error('unhandled_error', { path: '/foo' });
    logger.error('unhandled_error', { path: '/bar' });
    logger.warn('seed_failed', { error: 'x' });

    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs');
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.counts.error, 2);
    assert.equal(data.counts.warn, 1);
    assert.ok(Array.isArray(data.groups));
    const unhandled = data.groups.find((g) => g.code === 'unhandled_error');
    assert.equal(unhandled.count, 2);
    assert.deepEqual(unhandled.sources, ['buffer']);
  });

  it('filters by level', async () => {
    logger.error('unhandled_error');
    logger.warn('seed_failed');

    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs?level=error');
    const data = await res.json();
    const codes = data.entries.map((e) => e.code);
    assert.ok(codes.includes('unhandled_error'));
    assert.ok(!codes.includes('seed_failed'));
  });

  it('view=groups omits raw entries', async () => {
    logger.error('unhandled_error');
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs?view=groups');
    const data = await res.json();
    assert.ok(data.groups);
    assert.equal(data.entries, undefined);
  });

  it('view=entries omits groups', async () => {
    logger.error('unhandled_error');
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs?view=entries');
    const data = await res.json();
    assert.ok(data.entries);
    assert.equal(data.groups, undefined);
  });

  it('400 on invalid since', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs?since=not-a-date');
    assert.equal(res.status, 400);
  });

  it('surfaces CloudWatch failure explicitly instead of silently empty', async () => {
    // AWS_REGION is unset in beforeEach, so the SDK path returns an error.
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs');
    const data = await res.json();
    assert.equal(data.cloudwatch.error, 'AWS_REGION not set');
    assert.deepEqual(data.cloudwatch.logGroups, []);
  });

  it('cloudwatch=0 skips the AWS call', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/logs?cloudwatch=0');
    const data = await res.json();
    assert.equal(data.cloudwatch.error, null);
    assert.deepEqual(data.cloudwatch.logGroups, []);
  });

});

describe('Courses CRUD', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin', username: 'admin' };
      return { userId: id, role: 'user', name: 'User' };
    };
  });

  it('GET /v1/admin/courses returns sorted list with lessonCount', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'course:c-1', data: { name: 'Beta Course' }, updatedAt: '2026-01-02', version: 1 },
      { dataKey: 'course:c-2', data: { name: 'Alpha Course' }, updatedAt: '2026-01-01', version: 1 },
      { dataKey: 'lesson:l-1', data: { name: 'Lesson 1', markdown: '# x', status: 'public', course: 'c-1' } },
      { dataKey: 'lesson:l-2', data: { name: 'Lesson 2', markdown: '# y', status: 'public', course: 'c-1' } },
      { dataKey: 'lesson:l-3', data: { name: 'Lesson 3', markdown: '# z', status: 'public', course: 'c-2' } },
      { dataKey: 'lesson:l-4', data: { name: 'Lesson 4', markdown: '# w', status: 'public' } }, // no course
    ];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/courses');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 2);
    assert.equal(data[0].name, 'Alpha Course');
    assert.equal(data[0].lessonCount, 1);
    assert.equal(data[1].name, 'Beta Course');
    assert.equal(data[1].lessonCount, 2);
  });

  it('GET /v1/admin/courses/:id returns the course', async () => {
    db.getSyncData = async () => ({ data: { name: 'AI Foundations' }, updatedAt: '2026-01-01', version: 1 });
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/courses/c-1');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.courseId, 'c-1');
    assert.equal(data.name, 'AI Foundations');
  });

  it('GET /v1/admin/courses/:id returns 404 for missing course', async () => {
    db.getSyncData = async () => null;
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/courses/missing');
    assert.equal(res.status, 404);
  });

  it('PUT /v1/admin/courses/:id creates a new course', async () => {
    db.getAllSyncData = async () => [];
    db.getSyncData = async () => null;
    let saved = null;
    db.putSyncData = async (userId, dataKey, data) => { saved = { userId, dataKey, data }; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/courses/c-new', { name: '  New Course  ' });
    assert.equal(res.status, 200);
    assert.equal(saved.userId, '_system');
    assert.equal(saved.dataKey, 'course:c-new');
    assert.equal(saved.data.name, 'New Course');
    assert.equal(saved.data.description, undefined);
    assert.equal(saved.data.createdBy, 'usr_admin');
    assert.equal(saved.data.updatedBy, 'usr_admin');
  });

  it('PUT /v1/admin/courses/:id rejects empty name', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/courses/c-bad', { name: '   ' });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /name is required/i);
  });

  it('PUT /v1/admin/courses/:id rejects oversize name', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/courses/c-bad', { name: 'x'.repeat(81) });
    assert.equal(res.status, 400);
  });

  it('PUT /v1/admin/courses/:id rejects duplicate name (case-insensitive)', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'course:c-1', data: { name: 'AI Foundations' }, version: 1 },
    ];
    db.getSyncData = async () => null;
    db.putSyncData = async () => {};
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/courses/c-2', { name: 'ai foundations' });
    assert.equal(res.status, 409);
  });

  it('PUT /v1/admin/courses/:id allows renaming an existing course (same id)', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'course:c-1', data: { name: 'AI Foundations' }, version: 2 },
    ];
    db.getSyncData = async () => ({ data: { name: 'AI Foundations', createdBy: 'usr_admin', createdAt: '2026-01-01' }, version: 2 });
    let saved = null;
    db.putSyncData = async (userId, dataKey, data, version) => { saved = { userId, dataKey, data, version }; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/courses/c-1', { name: 'AI Foundations Updated' });
    assert.equal(res.status, 200);
    assert.equal(saved.data.name, 'AI Foundations Updated');
    assert.equal(saved.data.createdAt, '2026-01-01'); // preserved
  });

  it('DELETE /v1/admin/courses/:id removes the course and clears it from lessons', async () => {
    const initialItems = [
      { dataKey: 'lesson:l-1', data: { name: 'L1', markdown: '#', status: 'public', course: 'c-doom' }, version: 1 },
      { dataKey: 'lesson:l-2', data: { name: 'L2', markdown: '#', status: 'public', course: 'c-other' }, version: 1 },
      { dataKey: 'lesson:l-3', data: { name: 'L3', markdown: '#', status: 'public', course: 'c-doom' }, version: 1 },
    ];
    // The cascade re-reads each affected lesson before clearing its course,
    // so the per-lesson getSyncData has to return them freshly. The course
    // record itself is also looked up first to confirm it exists.
    db.getSyncData = async (uid, key) => {
      if (key === 'course:c-doom') return { data: { name: 'Doomed' }, version: 1 };
      const found = initialItems.find(i => i.dataKey === key);
      return found ? { data: found.data, version: found.version } : null;
    };
    db.getAllSyncData = async () => initialItems;
    let deleted = null;
    db.deleteSyncData = async (uid, key) => { deleted = key; };
    const cleared = [];
    db.putSyncData = async (uid, key, data) => { cleared.push({ key, course: data.course }); };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'DELETE', '/v1/admin/courses/c-doom');
    assert.equal(res.status, 200);
    assert.equal(deleted, 'course:c-doom');
    assert.equal(cleared.length, 2);
    assert.ok(cleared.every(c => c.course === null));
    assert.deepEqual(cleared.map(c => c.key).sort(), ['lesson:l-1', 'lesson:l-3']);
  });

  it('DELETE /v1/admin/courses/:id skips lessons whose course was reassigned mid-cascade', async () => {
    // Initial scan: l-1 references the doomed course. Then by the time the
    // per-lesson re-read happens, another admin has reassigned l-1 to a
    // different course. Our cascade should leave that reassignment alone.
    const initialItems = [
      { dataKey: 'lesson:l-1', data: { name: 'L1', markdown: '#', status: 'public', course: 'c-doom' }, version: 1 },
    ];
    let lessonRereadCount = 0;
    db.getSyncData = async (uid, key) => {
      if (key === 'course:c-doom') return { data: { name: 'Doomed' }, version: 1 };
      if (key === 'lesson:l-1') {
        lessonRereadCount++;
        // Simulated concurrent reassignment: by the time the cascade re-reads,
        // l-1 has been moved to a different course.
        return { data: { name: 'L1', markdown: '#', status: 'public', course: 'c-new' }, version: 2 };
      }
      return null;
    };
    db.getAllSyncData = async () => initialItems;
    db.deleteSyncData = async () => {};
    const cleared = [];
    db.putSyncData = async (uid, key, data) => { cleared.push({ key, course: data.course }); };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'DELETE', '/v1/admin/courses/c-doom');
    assert.equal(res.status, 200);
    assert.equal(lessonRereadCount, 1, 'cascade should re-read the lesson before deciding to write');
    assert.equal(cleared.length, 0, 'cascade should not touch a lesson whose course no longer matches');
  });

  it('DELETE /v1/admin/courses/:id returns 404 when course is missing', async () => {
    db.getSyncData = async () => null;
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'DELETE', '/v1/admin/courses/missing');
    assert.equal(res.status, 404);
  });
});

describe('PUT /v1/admin/lessons/:lessonId — course assignment', () => {
  const validMarkdown = `# Test Lesson

A test lesson.

## Exemplar
Produce a thing.

## Learning Objectives
- Can do thing one
- Can do thing two`;

  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin', username: 'admin' });
    db.getSyncData = async () => null;
  });

  it('persists the course field on create', async () => {
    let saved = null;
    db.putSyncData = async (uid, key, data) => { saved = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/l-1', {
      markdown: validMarkdown, name: 'Test Lesson', course: 'c-1',
    });
    assert.equal(res.status, 200);
    assert.equal(saved.course, 'c-1');
  });

  it('clears the course field when course=null is sent', async () => {
    db.getSyncData = async () => ({ data: { markdown: validMarkdown, name: 'Test', status: 'public', course: 'c-old' }, version: 1 });
    let saved = null;
    db.putSyncData = async (uid, key, data) => { saved = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/l-1', { course: null });
    assert.equal(res.status, 200);
    assert.equal(saved.course, null);
  });

  it('rejects non-string course values', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/l-1', {
      markdown: validMarkdown, name: 'Test Lesson', course: 123,
    });
    assert.equal(res.status, 400);
  });

  it('preserves existing course when body omits the field', async () => {
    db.getSyncData = async () => ({ data: { markdown: validMarkdown, name: 'Test', status: 'public', course: 'c-keep' }, version: 1 });
    let saved = null;
    db.putSyncData = async (uid, key, data) => { saved = data; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/lessons/l-1', { name: 'Renamed' });
    assert.equal(res.status, 200);
    assert.equal(saved.course, 'c-keep');
  });
});

describe('GET /v1/admin/users/:userId/stats', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user', name: 'Non-admin' };
      if (id === 'usr_learner') return { userId: 'usr_learner', role: 'user', name: 'Learner', email: 'l@x.com' };
      return null;
    };
  });

  it('returns 404 for unknown user', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users/usr_missing/stats');
    assert.equal(res.status, 404);
  });

  it('aggregates lessons completed, available, and percentiles', async () => {
    db.getAllSyncData = async (uid) => {
      if (uid === '_system') {
        return [
          { dataKey: 'lesson:l1', data: { name: 'Cognitive Load', status: 'public', markdown: '# L1' } },
          { dataKey: 'lesson:l2', data: { name: 'Active Recall', status: 'public', markdown: '# L2' } },
          { dataKey: 'lesson:l3', data: { name: 'Spaced Repetition', status: 'public', markdown: '# L3' } },
          { dataKey: 'lesson:l4', data: { name: 'Draft Lesson', status: 'draft', markdown: '' } }, // excluded
        ];
      }
      return [
        { dataKey: 'lessonKB:l1', data: { status: 'completed', activitiesCompleted: 11, completedAt: '2026-05-01T12:00:00Z' } },
        { dataKey: 'lessonKB:l2', data: { status: 'completed', activitiesCompleted: 22, completedAt: '2026-05-02T12:00:00Z' } },
        { dataKey: 'lessonKB:l3', data: { status: 'in_progress', activitiesCompleted: 3 } },
      ];
    };
    db.listAuditLogsForUser = async () => [];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users/usr_learner/stats');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.lessonsCompleted, 2);
    assert.equal(data.lessonsAvailable, 3, 'draft lesson should not count toward denominator');
    assert.equal(data.lessonDurations.length, 2);
    // p50 of [19.8, 39.6] → 39.6 (sorted[1] for p=50, idx = floor(0.5*2) = 1)
    assert.equal(data.completionMinutesP50, 39.6);
    assert.equal(data.completionMinutesP90, 39.6);
    // Lesson names looked up from _system
    const titles = data.lessonDurations.map((l) => l.lessonName).sort();
    assert.deepEqual(titles, ['Active Recall', 'Cognitive Load']);
  });

  it('excludes private/draft/custom completions from the per-learner numerator', async () => {
    db.getAllSyncData = async (uid) => {
      if (uid === '_system') return [
        { dataKey: 'lesson:l1', data: { name: 'Public', status: 'public', markdown: '# L1' } },
        { dataKey: 'lesson:l2', data: { name: 'Private', status: 'private', markdown: '# L2', sharedWith: ['usr_learner'] } },
        { dataKey: 'lesson:l3', data: { name: 'Draft', status: 'draft', markdown: '' } },
      ];
      return [
        { dataKey: 'lessonKB:l1', data: { status: 'completed', activitiesCompleted: 5, completedAt: '2026-05-01T12:00:00Z' } },
        { dataKey: 'lessonKB:l2', data: { status: 'completed', activitiesCompleted: 5, completedAt: '2026-05-02T12:00:00Z' } }, // private
        { dataKey: 'lessonKB:custom-xyz', data: { status: 'completed', activitiesCompleted: 5 } }, // custom
      ];
    };
    db.listAuditLogsForUser = async () => [];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users/usr_learner/stats');
    const data = await res.json();
    assert.equal(data.lessonsCompleted, 1, 'only the public completion counts');
    assert.equal(data.lessonsAvailable, 1, 'only the public lesson is available');
    assert.equal(data.lessonDurations.length, 1);
    assert.equal(data.lessonDurations[0].lessonName, 'Public');
  });

  it('returns lastActiveAt from the user record', async () => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_learner') return {
        userId: 'usr_learner',
        role: 'user',
        name: 'Learner',
        email: 'l@x.com',
        lastActiveAt: '2026-05-20T10:00:00Z',
      };
      return null;
    };
    db.getAllSyncData = async () => [];
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users/usr_learner/stats?days=7');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.windowDays, 7);
    assert.equal(data.lastActiveAt, '2026-05-20T10:00:00Z');
  });

  it('rejects non-admin', async () => {
    const app = new Hono(); app.route('/', admin);
    const res = await userReq(app, 'GET', '/v1/admin/users/usr_learner/stats');
    assert.equal(res.status, 403);
  });
});

describe('GET /v1/admin/users?include=stats', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      return null;
    };
  });

  it('recomputes completed PUBLIC lessons and heals an inflated stored counter', async () => {
    db.listAllUsers = async () => [
      // Stored counter is stale/inflated (counted a private completion before
      // the public-only filter existed). lastActiveAt already set.
      { userId: 'u1', email: 'u1@x.com', name: 'U1', role: 'user', createdAt: '2024-01-01',
        lessonsCompleted: 2, lastActiveAt: '2026-05-03T09:15:00.000Z' },
    ];
    db.getAllSyncData = async (uid) => {
      if (uid === '_system') return [
        { dataKey: 'lesson:l1', data: { status: 'public', markdown: '#' } },
        { dataKey: 'lesson:l2', data: { status: 'private', markdown: '#', sharedWith: ['u1'] } },
      ];
      if (uid === 'u1') return [
        { dataKey: 'lessonKB:l1', data: { status: 'completed' } },   // public → counts
        { dataKey: 'lessonKB:l2', data: { status: 'completed' } },   // private → excluded
      ];
      return [];
    };
    const writes = [];
    db.setUserActivityField = async (userId, field, value) => { writes.push({ userId, field, value }); };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users?include=stats');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data[0].lessonsCompleted, 1, 'only the public completion counts');
    assert.equal(data[0].lessonsAvailable, 1, 'private-shared lesson excluded from denominator');
    assert.equal(data[0].lastActiveAt, '2026-05-03T09:15:00.000Z');
    // Stored counter healed from 2 → 1
    assert.ok(writes.some((w) => w.field === 'lessonsCompleted' && w.value === 1));
  });

  it('lazy-backfills counters for legacy users on first read and persists them', async () => {
    db.listAllUsers = async () => [
      // No lessonsCompleted / lastActiveAt — pre-#136 user record
      { userId: 'u1', email: 'u1@x.com', name: 'U1', role: 'user', createdAt: '2024-01-01' },
    ];
    db.getAllSyncData = async (uid) => {
      if (uid === '_system') return [
        { dataKey: 'lesson:l1', data: { status: 'public', markdown: '#' } },
        { dataKey: 'lesson:l2', data: { status: 'public', markdown: '#' } },
      ];
      if (uid === 'u1') return [
        { dataKey: 'lessonKB:l1', data: { status: 'completed' } },
        { dataKey: 'lessonKB:l2', data: { status: 'completed' } },
        { dataKey: 'messages:l1', data: [{ timestamp: '2026-05-03T09:15:00Z' }] },
      ];
      return [];
    };
    const writes = [];
    db.setUserActivityField = async (userId, field, value) => { writes.push({ userId, field, value }); };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users?include=stats');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data[0].lessonsCompleted, 2);
    assert.equal(data[0].lastActiveAt, '2026-05-03T09:15:00.000Z');
    // Both fields persisted back to the user record so subsequent reads are O(1)
    assert.ok(writes.some((w) => w.field === 'lessonsCompleted' && w.value === 2));
    assert.ok(writes.some((w) => w.field === 'lastActiveAt' && w.value === '2026-05-03T09:15:00.000Z'));
  });

  it('omits stats fields by default', async () => {
    db.listAllUsers = async () => [
      { userId: 'u1', email: 'u1@x.com', name: 'U1', role: 'user', createdAt: '2024-01-01' },
    ];
    let scanned = false;
    db.getAllSyncData = async () => { scanned = true; return []; };
    const app = new Hono(); app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/users');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data[0].lessonsCompleted, undefined);
    assert.equal(data[0].lessonsAvailable, undefined);
    assert.equal(data[0].lastActiveAt, undefined);
    assert.equal(scanned, false, 'base endpoint should not scan sync-data');
  });
});
