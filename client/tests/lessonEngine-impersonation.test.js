/**
 * Tests for the lessonEngine impersonation guard.
 *
 * The guard reads sessionStorage('plato_impersonation') at the top of write
 * paths (startLesson, sendMessage) and throws — defense-in-depth on top of
 * the disabled ComposeBar UI for the "View as User" admin feature. A write
 * here would corrupt the impersonated learners record using the admins JWT
 * (which is what the Function URL actually authorizes against).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const sessionStore = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
globalThis.sessionStorage = sessionStore;
globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
globalThis.fetch = async () => ({ ok: false, status: 404 });

const { startLesson, sendMessage } = await import('../src/lib/lessonEngine.js');

describe('lessonEngine impersonation guard', () => {
  beforeEach(() => sessionStore.clear());

  it('startLesson throws when sessionStorage has plato_impersonation', async () => {
    sessionStore.setItem('plato_impersonation', JSON.stringify({ userId: 'usr_target' }));
    await assert.rejects(
      () => startLesson('lesson-1', { name: 'L' }, () => {}),
      /Cannot start a lesson while viewing as another user/
    );
  });

  it('sendMessage throws when sessionStorage has plato_impersonation', async () => {
    sessionStore.setItem('plato_impersonation', JSON.stringify({ userId: 'usr_target' }));
    await assert.rejects(
      () => sendMessage('lesson-1', { name: 'L' }, 'hello', null, () => {}),
      /Cannot send a message while viewing as another user/
    );
  });

  it('does not throw when impersonation is not active (guard is opt-in)', async () => {
    // Both functions will fail downstream because we havent stubbed the storage
    // / orchestrator layer — but they must NOT fail with the impersonation
    // message. Any other rejection is fine for this test.
    await assert.rejects(
      () => startLesson('lesson-1', { name: 'L' }, () => {}),
      (err) => !/viewing as another user/.test(err.message),
    );
  });
});
