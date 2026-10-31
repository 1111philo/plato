/**
 * Tests for lesson message storage — verifies messages are appended, not replaced.
 *
 * Mocks globalThis.fetch and seeds auth tokens to test the full
 * saveLessonMessages → getLessonMessages flow through the real storage layer.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory server store
const _serverStore = new Map();
const _serverVersions = new Map();

// Mock fetch before any imports that use it
globalThis.fetch = async (url, opts) => {
  const path = new URL(url, 'http://localhost').pathname;
  const syncMatch = path.match(/^\/v1\/sync\/(.+)/);
  if (!syncMatch) return { ok: false, status: 404 };
  const key = decodeURIComponent(syncMatch[1]);

  if (opts?.method === 'PUT') {
    const body = JSON.parse(opts.body);
    const currentVersion = _serverVersions.get(key) || 0;
    if (body.version !== currentVersion) {
      return { ok: false, status: 409, json: async () => ({}) };
    }
    const newVersion = currentVersion + 1;
    _serverStore.set(key, body.data);
    _serverVersions.set(key, newVersion);
    return { ok: true, json: async () => ({ version: newVersion }) };
  }

  if (opts?.method === 'DELETE') {
    _serverStore.delete(key);
    _serverVersions.delete(key);
    return { ok: true, json: async () => ({ ok: true }) };
  }

  // GET
  if (_serverStore.has(key)) {
    return { ok: true, json: async () => ({ data: _serverStore.get(key), version: _serverVersions.get(key) || 0 }) };
  }
  return { ok: false, status: 404 };
};

// Mock localStorage for auth tokens
globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};

// Seed auth tokens so authenticatedFetch doesn't throw
localStorage.setItem('plato_auth', JSON.stringify({
  accessToken: 'test-token',
  refreshToken: 'test-refresh',
}));

const { clearCache, saveLessonMessages, getLessonMessages } = await import('../js/storage.js');

describe('saveLessonMessages', () => {
  beforeEach(() => {
    clearCache();
    _serverStore.clear();
    _serverVersions.clear();
  });

  it('appends messages to an empty lesson', async () => {
    await saveLessonMessages('lesson-1', [
      { role: 'assistant', content: 'Hello' },
    ]);
    const msgs = await getLessonMessages('lesson-1');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, 'Hello');
  });

  it('appends new messages to existing ones instead of replacing', async () => {
    await saveLessonMessages('lesson-1', [
      { role: 'assistant', content: 'Welcome to the lesson.' },
    ]);

    await saveLessonMessages('lesson-1', [
      { role: 'user', content: 'Hi there' },
      { role: 'assistant', content: 'Let us begin.' },
    ]);

    const msgs = await getLessonMessages('lesson-1');
    assert.equal(msgs.length, 3, `Expected 3 messages, got ${msgs.length}: ${msgs.map(m => m.content).join(', ')}`);
    assert.equal(msgs[0].content, 'Welcome to the lesson.');
    assert.equal(msgs[1].content, 'Hi there');
    assert.equal(msgs[2].content, 'Let us begin.');
  });

  it('preserves full history across many exchanges', async () => {
    for (let i = 0; i < 5; i++) {
      await saveLessonMessages('lesson-1', [
        { role: 'user', content: `msg ${i * 2}` },
        { role: 'assistant', content: `msg ${i * 2 + 1}` },
      ]);
    }

    const msgs = await getLessonMessages('lesson-1');
    assert.equal(msgs.length, 10, `Expected 10 messages, got ${msgs.length}`);
    for (let i = 0; i < 10; i++) {
      assert.equal(msgs[i].content, `msg ${i}`);
    }
  });

  it('persists messages to the server', async () => {
    await saveLessonMessages('lesson-1', [
      { role: 'assistant', content: 'First' },
    ]);
    await saveLessonMessages('lesson-1', [
      { role: 'user', content: 'Second' },
    ]);

    const serverData = _serverStore.get('messages:lesson-1');
    assert.equal(serverData.length, 2);
    assert.equal(serverData[0].content, 'First');
    assert.equal(serverData[1].content, 'Second');
  });

  it('survives a cache clear (simulating page refresh)', async () => {
    await saveLessonMessages('lesson-1', [
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Hi' },
    ]);

    clearCache();

    const msgs = await getLessonMessages('lesson-1');
    assert.equal(msgs.length, 2);

    await saveLessonMessages('lesson-1', [
      { role: 'assistant', content: 'Welcome back' },
    ]);

    const allMsgs = await getLessonMessages('lesson-1');
    assert.equal(allMsgs.length, 3);
    assert.equal(allMsgs[2].content, 'Welcome back');
  });

  it('adds timestamps to messages that lack them', async () => {
    await saveLessonMessages('lesson-1', [
      { role: 'assistant', content: 'Hello' },
    ]);
    const msgs = await getLessonMessages('lesson-1');
    assert.ok(typeof msgs[0].timestamp === 'number');
  });
});

describe('fitMessages (#451 review M1)', async () => {
  const { fitMessages } = await import('../js/storage.js');
  const agents = Array.from({ length: 4 }, () => ({ agent: 'coach', label: 'Coach', notes: ['x'.repeat(250)] }));
  const convo = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}`, metadata: i % 2 ? { agents } : null }));
  it('leaves a record under the budget alone', () => {
    assert.equal(fitMessages(convo, 10_000_000), convo);
  });
  it('drops agent detail from the oldest replies until it fits, keeping every message and its text', () => {
    const budget = JSON.stringify(convo).length - 20_000;
    const out = fitMessages(convo, budget);
    assert.equal(out.length, convo.length);
    assert.deepEqual(out.map((m) => m.content), convo.map((m) => m.content));
    assert.ok(JSON.stringify(out).length <= budget);
    assert.equal(out[1].metadata, null, 'oldest reply trimmed');
    assert.ok(out[out.length - 1].metadata.agents, 'newest reply keeps its detail');
  });
});

describe('conversationTooLong (#451 second review N4)', async () => {
  const { conversationTooLong, MESSAGES_BUDGET } = await import('../js/storage.js');
  it('is true only when the text alone is past the budget, counted in UTF-8 bytes', async () => {
    clearCache();
    await saveLessonMessages('long-1', [{ role: 'user', content: 'short' }]);
    assert.equal(conversationTooLong('long-1'), false);
    // Under the budget in characters, over it in bytes (3 bytes each).
    await saveLessonMessages('long-1', [{ role: 'user', content: '学'.repeat(Math.ceil(MESSAGES_BUDGET / 2.5)) }]);
    assert.equal(conversationTooLong('long-1'), true);
    assert.equal(conversationTooLong('never-loaded'), false);
  });
});
