/**
 * Tests for mergeProfile — how an agent's profile update is merged into the
 * stored profile. The load-bearing invariant for issue #228's profile-update
 * fix: `masteredLessons`/`activeLessons` are system-managed and must survive
 * even though the profile-update agents no longer echo them back (dropping the
 * arrays from the agent's output is what keeps it under `max_tokens`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// profileQueue imports storage/orchestrator, which touch these globals at
// import time (mirrors courseProgressQueue.test.js).
globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
globalThis.fetch = async () => ({ ok: false, status: 404 });

const { mergeProfile } = await import('../src/lib/profileQueue.js');

describe('mergeProfile', () => {
  it('preserves existing bookkeeping arrays when the agent omits them', () => {
    // The agent no longer returns masteredLessons/activeLessons (#228) — the
    // stored values must carry through unchanged.
    const existing = {
      name: 'Ada', goal: 'learn',
      masteredLessons: ['l1', 'l2'], activeLessons: ['l3'],
      strengths: ['a'], weaknesses: ['b'], preferences: { platform: 'Mac' },
      createdAt: 1, updatedAt: 1,
    };
    const returned = { strengths: ['a2'], weaknesses: ['b2'], updatedAt: 2 };
    const merged = mergeProfile(existing, returned);
    assert.deepEqual(merged.masteredLessons, ['l1', 'l2']);
    assert.deepEqual(merged.activeLessons, ['l3']);
  });

  it('unions bookkeeping arrays when the agent (or code) supplies a new id', () => {
    // The completion path injects the newly-mastered lessonId into the result.
    const existing = { masteredLessons: ['l1'], activeLessons: [] };
    const returned = { masteredLessons: ['l2'] };
    const merged = mergeProfile(existing, returned);
    assert.deepEqual(merged.masteredLessons, ['l1', 'l2']);
  });

  it('does not duplicate an id already present in both', () => {
    const merged = mergeProfile({ masteredLessons: ['l1'] }, { masteredLessons: ['l1'] });
    assert.deepEqual(merged.masteredLessons, ['l1']);
  });

  it('takes returned strengths/weaknesses when non-empty, else keeps existing', () => {
    const existing = { strengths: ['old'], weaknesses: ['oldw'] };
    assert.deepEqual(mergeProfile(existing, { strengths: ['new'] }).strengths, ['new']);
    assert.deepEqual(mergeProfile(existing, { strengths: [] }).strengths, ['old']);
    assert.deepEqual(mergeProfile(existing, {}).weaknesses, ['oldw']);
  });

  it('merges preferences and only overwrites name/goal when truthy', () => {
    const existing = { name: 'Ada', goal: 'g1', preferences: { platform: 'Mac', experienceLevel: 'beginner' } };
    const merged = mergeProfile(existing, { name: '', goal: 'g2', preferences: { platform: 'Windows' } });
    assert.equal(merged.name, 'Ada');            // empty string does not clobber
    assert.equal(merged.goal, 'g2');
    assert.equal(merged.preferences.platform, 'Windows');
    assert.equal(merged.preferences.experienceLevel, 'beginner'); // preserved
  });
});
