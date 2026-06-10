import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import sync from '../../src/routes/sync.js';
import { on, _reset as resetHooks } from '../../src/lib/plugins/hooks.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

// Silence console
const origErr = console.error;
const origWarn = console.warn;
console.error = () => {};
console.warn = () => {};

describe('POST /v1/sync/lesson-started', () => {
  let app;
  let token;
  const userId = 'test-user-lesson-started';

  before(async () => {
    // Create test user
    await db.createUser({
      userId,
      email: 'test@example.com',
      username: 'testuser',
      passwordHash: 'hashed-password',
      name: 'Test User',
      role: 'user',
    });
    token = signAccessToken(userId, 'user');

    // Mount route
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', userId);
      c.set('role', 'user');
      await next();
    });
    app.route('/', sync);
  });

  after(async () => {
    await db.deleteUser(userId);
    resetHooks();
  });

  it('emits lessonStarted hook with correct payload', async () => {
    let hookPayload = null;
    on('lessonStarted', (payload) => {
      hookPayload = payload;
      return null; // No enrichment
    });

    const req = new Request('http://localhost/v1/sync/lesson-started', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        lessonId: 'test-lesson',
        lesson: {
          name: 'Test Lesson',
          markdown: '# Test',
          exemplar: 'Understand testing',
          learningObjectives: ['Write tests', 'Run tests'],
        },
        lessonKB: {
          objectives: [],
          insights: [],
        },
      }),
    });

    const res = await app.fetch(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.enrichments));

    // Verify hook was called with correct payload
    assert.ok(hookPayload);
    assert.equal(hookPayload.userId, userId);
    assert.equal(hookPayload.lessonId, 'test-lesson');
    assert.equal(hookPayload.lesson.name, 'Test Lesson');
    assert.equal(hookPayload.lesson.exemplar, 'Understand testing');
    assert.deepEqual(hookPayload.lesson.learningObjectives, ['Write tests', 'Run tests']);
    assert.ok(hookPayload.lessonKB);
  });

  it('collects enrichments from hook handlers', async () => {
    resetHooks();

    on('lessonStarted', () => ({
      pluginId: 'test-plugin-1',
      label: 'Test Plugin 1',
      context: 'This is context from plugin 1',
      reasoning: 'Because reasons',
      sources: [{ url: 'https://example.com/doc1', title: 'Doc 1' }],
    }));

    on('lessonStarted', () => ({
      pluginId: 'test-plugin-2',
      label: 'Test Plugin 2',
      context: 'This is context from plugin 2',
      reasoning: 'More reasons',
      sources: [{ url: 'https://example.com/doc2', title: 'Doc 2' }],
    }));

    const req = new Request('http://localhost/v1/sync/lesson-started', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        lessonId: 'test-lesson-2',
        lesson: {
          name: 'Test Lesson 2',
          markdown: '# Test',
          exemplar: 'Learn enrichment',
          learningObjectives: ['Understand plugins'],
        },
        lessonKB: {},
      }),
    });

    const res = await app.fetch(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.enrichments.length, 2);
    assert.equal(data.enrichments[0].pluginId, 'test-plugin-1');
    assert.equal(data.enrichments[0].context, 'This is context from plugin 1');
    assert.equal(data.enrichments[1].pluginId, 'test-plugin-2');
    assert.equal(data.enrichments[1].context, 'This is context from plugin 2');
  });

  it('filters out null enrichments from handlers', async () => {
    resetHooks();

    on('lessonStarted', () => ({
      pluginId: 'good-plugin',
      label: 'Good Plugin',
      context: 'Valid context',
    }));

    on('lessonStarted', () => null); // This plugin doesn't enrich this lesson

    const req = new Request('http://localhost/v1/sync/lesson-started', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        lessonId: 'test-lesson-3',
        lesson: {
          name: 'Test Lesson 3',
          markdown: '# Test',
          exemplar: 'Test filtering',
          learningObjectives: ['Filter nulls'],
        },
        lessonKB: {},
      }),
    });

    const res = await app.fetch(req);
    const data = await res.json();

    assert.equal(data.enrichments.length, 1);
    assert.equal(data.enrichments[0].pluginId, 'good-plugin');
  });

  it('requires lessonId, lesson, and lessonKB', async () => {
    const req = new Request('http://localhost/v1/sync/lesson-started', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        lessonId: 'test',
        // Missing lesson and lessonKB
      }),
    });

    const res = await app.fetch(req);
    assert.equal(res.status, 400);

    const data = await res.json();
    assert.ok(data.error);
  });

  it('fails open when hook handler throws', async () => {
    resetHooks();

    on('lessonStarted', () => {
      throw new Error('Plugin error');
    });

    on('lessonStarted', () => ({
      pluginId: 'working-plugin',
      label: 'Working Plugin',
      context: 'This plugin works',
    }));

    const req = new Request('http://localhost/v1/sync/lesson-started', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        lessonId: 'test-lesson-4',
        lesson: {
          name: 'Test Lesson 4',
          markdown: '# Test',
          exemplar: 'Test error handling',
          learningObjectives: ['Handle errors gracefully'],
        },
        lessonKB: {},
      }),
    });

    const res = await app.fetch(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    // The erroring plugin is skipped, but the working one succeeds
    assert.equal(data.enrichments.length, 1);
    assert.equal(data.enrichments[0].pluginId, 'working-plugin');
  });
});

process.on('exit', () => {
  console.error = origErr;
  console.warn = origWarn;
});
