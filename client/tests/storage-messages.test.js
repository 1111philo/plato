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
