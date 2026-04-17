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

describe('POST /v1/admin/invites', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getUserByEmail = async () => null;
    db.getInviteByEmail = async () => null;
    db.createInvite = async () => {};
  });

  it('creates invite', async () => {
    // Stub sendInviteEmail via dynamic import mock approach
    const { sendInviteEmail } = await import('../../src/lib/email.js');
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

describe('draft conversation endpoints', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  });

  it('saves and retrieves a draft conversation', async () => {
    let stored = null;
    db.getSyncData = async () => stored ? { data: stored, version: 1 } : null;
    db.putSyncData = async (uid, key, data) => { stored = data; };
    db.deleteSyncData = async () => { stored = null; };
    const app = new Hono(); app.route('/', admin);

    // Save draft
    const convo = [{ role: 'user', content: 'new lesson' }];
    const putRes = await adminReq(app, 'PUT', '/v1/admin/draft-conversation', { conversation: convo, readiness: 3 });
    assert.equal(putRes.status, 200);

    // Get draft
    const getRes = await adminReq(app, 'GET', '/v1/admin/draft-conversation');
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.deepEqual(data.conversation, convo);
    assert.equal(data.readiness, 3);

    // Delete draft
    const delRes = await adminReq(app, 'DELETE', '/v1/admin/draft-conversation');
    assert.equal(delRes.status, 200);

    // Get after delete returns null
    const emptyRes = await adminReq(app, 'GET', '/v1/admin/draft-conversation');
    const emptyData = await emptyRes.json();
    assert.equal(emptyData.conversation, null);
  });
});

describe('GET /v1/admin/stats/lessons', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  });

  it('returns aggregated lesson stats', async () => {
    db.listAllUsers = async () => [
      { userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' },
    ];
    db.getAllSyncData = async (userId) => {
      if (userId === 'u1') return [
        { dataKey: 'lessonKB:c1', data: { status: 'completed', progress: 10, activitiesCompleted: 6, startedAt: 1000000, completedAt: 1600000 } },
        { dataKey: 'lessonKB:c2', data: { status: 'active', progress: 4, activitiesCompleted: 3 } },
        { dataKey: 'profile', data: {} },
      ];
      if (userId === 'u2') return [
        { dataKey: 'lessonKB:c1', data: { status: 'completed', progress: 10, activitiesCompleted: 15, startedAt: 1000000, completedAt: 2200000 } },
      ];
      // u3: hit hard limit (22 exchanges, progress < 10)
      return [
        { dataKey: 'lessonKB:c1', data: { status: 'completed', progress: 7, activitiesCompleted: 22, startedAt: 1000000, completedAt: 2800000 } },
      ];
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.totalCompletions, 3);
    assert.equal(data.withinTarget, 1);
    assert.equal(data.overTarget, 1);
    assert.equal(data.hitHardLimit, 1);
    assert.equal(data.activeLessons, 1);
    assert.equal(data.avgExchangesWithinTarget, 6);
    assert.equal(data.exchangeTarget, 11);
    assert.equal(data.hardLimit, 22);
    assert.equal(data.avgDurationMinutes, 20);
  });

  it('returns nulls when no completions', async () => {
    db.listAllUsers = async () => [];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/stats/lessons');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.totalCompletions, 0);
    assert.equal(data.avgExchangesPerCompletion, null);
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

  it('normalizes legacy draft to private in admin list', async () => {
    db.getAllSyncData = async () => [{
      dataKey: 'lesson:old-1',
      data: { name: 'Old Draft', status: 'draft', sharedWith: ['usr_1'] },
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
