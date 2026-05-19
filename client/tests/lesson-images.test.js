/**
 * Tests for screenshot persistence and message-image hydration.
 *
 * Pasted images are stored one-per-record as `screenshot:*` sync data, and
 * conversation messages reference them by KEY only — this is what keeps the
 * `messages:*` record small enough for DynamoDB's 400 KB item limit
 * (issues #191, #193). Verifies the round-trip and that `resumeLesson`'s
 * hydration resolves keys back to data URLs for rendering.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory server store, keyed like the sync-data table.
const _serverStore = new Map();
const _serverVersions = new Map();

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
  if (_serverStore.has(key)) {
    return { ok: true, json: async () => ({ data: _serverStore.get(key), version: _serverVersions.get(key) || 0 }) };
  }
  return { ok: false, status: 404 };
};

globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
localStorage.setItem('plato_auth', JSON.stringify({
  accessToken: 'test-token', refreshToken: 'test-refresh',
}));

const {
  clearCache, saveScreenshot, getScreenshot, deleteScreenshot,
  saveLessonMessages, deleteLessonProgress,
} = await import('../js/storage.js');
const { hydrateMessageImages } = await import('../src/lib/lessonEngine.js');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('saveScreenshot / getScreenshot', () => {
  beforeEach(() => {
    clearCache();
    _serverStore.clear();
    _serverVersions.clear();
  });

  it('persists a screenshot to the server as its own record', async () => {
    await saveScreenshot('lesson-1-123-0', PNG);
    assert.equal(_serverStore.get('screenshot:lesson-1-123-0'), PNG);
  });

  it('round-trips through the server after a cache clear', async () => {
    await saveScreenshot('lesson-1-123-0', PNG);
    clearCache();
    assert.equal(await getScreenshot('lesson-1-123-0'), PNG);
  });

  it('returns null for an unknown key', async () => {
    assert.equal(await getScreenshot('does-not-exist'), null);
  });

  it('deleteScreenshot removes the record', async () => {
    await saveScreenshot('lesson-1-123-0', PNG);
    await deleteScreenshot('lesson-1-123-0');
    assert.equal(_serverStore.has('screenshot:lesson-1-123-0'), false);
  });
});

describe('hydrateMessageImages', () => {
  beforeEach(() => {
    clearCache();
    _serverStore.clear();
    _serverVersions.clear();
  });

  it('leaves text-only messages untouched', async () => {
    const msgs = [{ role: 'user', content: 'hello' }];
    assert.deepEqual(await hydrateMessageImages(msgs), msgs);
  });

  it('resolves imageKeys to imageDataUrls for rendering', async () => {
    await saveScreenshot('k1', PNG);
    const [msg] = await hydrateMessageImages([
      { role: 'user', content: '[image]', metadata: { imageKeys: ['k1'] } },
    ]);
    assert.deepEqual(msg.metadata.imageDataUrls, [PNG]);
    assert.deepEqual(msg.metadata.imageKeys, ['k1'], 'keys are preserved');
  });

  it('drops missing screenshots instead of rendering blanks', async () => {
    const [msg] = await hydrateMessageImages([
      { role: 'user', content: '[image]', metadata: { imageKeys: ['gone'] } },
    ]);
    assert.equal(msg.metadata.imageDataUrls, undefined);
  });

  it('leaves legacy embedded imageDataUrls untouched (pre-#193 records)', async () => {
    const legacy = [{ role: 'user', content: '[image]', metadata: { imageDataUrls: [PNG] } }];
    assert.deepEqual(await hydrateMessageImages(legacy), legacy);
  });

  it('tolerates null / empty input', async () => {
    assert.deepEqual(await hydrateMessageImages(null), []);
    assert.deepEqual(await hydrateMessageImages([]), []);
  });
});

describe('deleteLessonProgress — screenshot cleanup', () => {
  beforeEach(() => {
    clearCache();
    _serverStore.clear();
    _serverVersions.clear();
  });

  it('deletes screenshot records referenced by the lesson messages', async () => {
    await saveScreenshot('lesson-x-1-0', PNG);
    await saveScreenshot('lesson-x-2-0', PNG);
    await saveLessonMessages('lesson-x', [
      { role: 'user', content: '[image]', metadata: { imageKeys: ['lesson-x-1-0'] } },
      { role: 'user', content: '[image]', metadata: { imageKeys: ['lesson-x-2-0'] } },
    ]);

    await deleteLessonProgress('lesson-x');

    assert.equal(_serverStore.has('screenshot:lesson-x-1-0'), false);
    assert.equal(_serverStore.has('screenshot:lesson-x-2-0'), false);
    assert.equal(_serverStore.has('messages:lesson-x'), false);
  });
});
