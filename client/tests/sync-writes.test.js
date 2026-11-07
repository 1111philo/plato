/**
 * Each save is written once (#451 scale review H2): the save* helpers PUT
 * directly and report whether it landed; `syncIfUnsaved` retries in the
 * background only when it didn't. And a coach turn updates the profile only
 * from an explicit [PROFILE_UPDATE].
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let puts = [];
let failNext = 0;
globalThis.fetch = async (url, opts) => {
  const path = new URL(url, 'http://localhost').pathname;
  const key = decodeURIComponent(path.replace(/^\/v1\/sync\//, ''));
  if (opts?.method === 'PUT') {
    puts.push(key);
    if (failNext > 0) { failNext--; return { ok: false, status: 503, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ version: puts.length }) };
  }
  return { ok: false, status: 404 };
};
globalThis.localStorage = {
  _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = v; }, removeItem(k) { delete this._s[k]; }, clear() { this._s = {}; },
};
globalThis.localStorage.setItem('plato_auth', JSON.stringify({ accessToken: 't', refreshToken: 'r' }));

const { saveLessonKB, saveLearnerProfile, clearCache } = await import('../js/storage.js');
const { syncIfUnsaved } = await import('../src/lib/syncDebounce.js');
const { shouldUpdateProfile } = await import('../src/lib/lessonEngine.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const origError = console.error;

describe('one write per save', () => {
  beforeEach(() => { puts = []; failNext = 0; clearCache(); console.error = () => {}; });

  it('a save that lands is not re-sent in the background', async () => {
    const saved = await saveLessonKB('les-1', { progress: 3 });
    assert.equal(saved, true);
    syncIfUnsaved(saved, 'lessonKB:les-1');
    await wait(700);
    assert.deepEqual(puts, ['lessonKB:les-1']);
  });

  it('a save that fails is retried once in the background', async () => {
    failNext = 1;
    const saved = await saveLearnerProfile({ name: 'Ada' });
    assert.equal(saved, false);
    syncIfUnsaved(saved, 'profile');
    await wait(700);
    assert.deepEqual(puts, ['profile', 'profile']);
    console.error = origError;
  });
});

describe('profile updates from a coach turn', () => {
  it('only an explicit [PROFILE_UPDATE] observation triggers one (not KB insights)', () => {
    assert.equal(shouldUpdateProfile({ profileUpdate: { observation: 'Uses a phone' } }), true);
    assert.equal(shouldUpdateProfile({ kbUpdate: { insights: ['Gave a concrete example'] } }), false);
    assert.equal(shouldUpdateProfile({ profileUpdate: { observation: '  ' } }), false);
    assert.equal(shouldUpdateProfile({}), false);
  });
});
