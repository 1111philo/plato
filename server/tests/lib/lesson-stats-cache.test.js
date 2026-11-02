/**
 * Pure helpers of the stale-while-revalidate lesson-stats cache
 * (src/lib/lesson-stats-cache.js). kickoffAsyncRefresh is deliberately not
 * covered here — it invokes Lambda.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_TTL_MS,
  MAX_AGE_MS,
  isSelfInvokeEvent,
  cacheAgeMs,
  classifyCache,
} from '../../src/lib/lesson-stats-cache.js';

const NOW = Date.parse('2026-01-15T12:00:00.000Z');

// Pin Date.now() so age arithmetic is exact at the TTL boundaries.
function freeze(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
}

// A cached record whose computedAt is `ageMs` before NOW.
const cachedAgo = (ageMs) => ({ data: { computedAt: new Date(NOW - ageMs).toISOString() } });

describe('lesson-stats-cache', () => {
  it('exports the documented TTLs', () => {
    assert.equal(FRESH_TTL_MS, 10 * 60 * 1000);
    assert.equal(MAX_AGE_MS, 24 * 60 * 60 * 1000);
    assert.ok(FRESH_TTL_MS < MAX_AGE_MS);
  });

  describe('isSelfInvokeEvent', () => {
    it('recognises the internal refresh marker', () => {
      assert.equal(isSelfInvokeEvent({ __platoInternal: 'refreshLessonStats' }), true);
      assert.equal(isSelfInvokeEvent({ __platoInternal: 'refreshLessonStats', extra: 1 }), true);
    });

    it('rejects other markers and non-marked events', () => {
      assert.equal(isSelfInvokeEvent({ __platoInternal: 'somethingElse' }), false);
      assert.equal(isSelfInvokeEvent({ __platoInternal: '' }), false);
      assert.equal(isSelfInvokeEvent({ rawPath: '/v1/admin/stats/lessons', headers: {} }), false);
      assert.equal(isSelfInvokeEvent({}), false);
    });

    it('is falsy for null, undefined and primitives', () => {
      assert.ok(!isSelfInvokeEvent(null));
      assert.ok(!isSelfInvokeEvent(undefined));
      assert.ok(!isSelfInvokeEvent('refreshLessonStats'));
      assert.ok(!isSelfInvokeEvent(42));
      assert.ok(!isSelfInvokeEvent(true));
    });
  });

  describe('cacheAgeMs', () => {
    it('returns the elapsed time since computedAt', (t) => {
      freeze(t);
      assert.equal(cacheAgeMs(cachedAgo(0)), 0);
      assert.equal(cacheAgeMs(cachedAgo(5000)), 5000);
      assert.equal(cacheAgeMs(cachedAgo(FRESH_TTL_MS)), FRESH_TTL_MS);
    });

    it('accepts any Date.parse-able computedAt', (t) => {
      freeze(t);
      const iso = new Date(NOW - 60_000).toISOString();
      assert.equal(cacheAgeMs({ data: { computedAt: iso } }), 60_000);
      assert.equal(cacheAgeMs({ data: { computedAt: new Date(NOW - 60_000).toUTCString() } }), 60_000);
    });

    it('is negative for a computedAt in the future', (t) => {
      freeze(t);
      assert.equal(cacheAgeMs(cachedAgo(-1000)), -1000);
    });

    it('is Infinity when there is no cached record or no computedAt', () => {
      assert.equal(cacheAgeMs(undefined), Infinity);
      assert.equal(cacheAgeMs(null), Infinity);
      assert.equal(cacheAgeMs({}), Infinity);
      assert.equal(cacheAgeMs({ data: null }), Infinity);
      assert.equal(cacheAgeMs({ data: {} }), Infinity);
      assert.equal(cacheAgeMs({ data: { computedAt: '' } }), Infinity);
      assert.equal(cacheAgeMs({ data: { computedAt: null } }), Infinity);
    });

    it('is Infinity when computedAt is not a parseable date', () => {
      assert.equal(cacheAgeMs({ data: { computedAt: 'not a date' } }), Infinity);
      assert.equal(cacheAgeMs({ data: { computedAt: 'yesterday' } }), Infinity);
    });
  });

  describe('classifyCache', () => {
    it('is fresh below FRESH_TTL_MS', (t) => {
      freeze(t);
      assert.equal(classifyCache(cachedAgo(0)), 'fresh');
      assert.equal(classifyCache(cachedAgo(1)), 'fresh');
      assert.equal(classifyCache(cachedAgo(FRESH_TTL_MS / 2)), 'fresh');
      assert.equal(classifyCache(cachedAgo(FRESH_TTL_MS - 1)), 'fresh');
    });

    it('turns stale exactly at FRESH_TTL_MS', (t) => {
      freeze(t);
      assert.equal(classifyCache(cachedAgo(FRESH_TTL_MS - 1)), 'fresh');
      assert.equal(classifyCache(cachedAgo(FRESH_TTL_MS)), 'stale');
      assert.equal(classifyCache(cachedAgo(FRESH_TTL_MS + 1)), 'stale');
    });

    it('stays stale between FRESH_TTL_MS and MAX_AGE_MS', (t) => {
      freeze(t);
      assert.equal(classifyCache(cachedAgo(60 * 60 * 1000)), 'stale');
      assert.equal(classifyCache(cachedAgo(MAX_AGE_MS / 2)), 'stale');
      assert.equal(classifyCache(cachedAgo(MAX_AGE_MS - 1)), 'stale');
    });

    it('expires exactly at MAX_AGE_MS', (t) => {
      freeze(t);
      assert.equal(classifyCache(cachedAgo(MAX_AGE_MS - 1)), 'stale');
      assert.equal(classifyCache(cachedAgo(MAX_AGE_MS)), 'expired');
      assert.equal(classifyCache(cachedAgo(MAX_AGE_MS + 1)), 'expired');
      assert.equal(classifyCache(cachedAgo(7 * MAX_AGE_MS)), 'expired');
    });

    it('treats a future computedAt as fresh (negative age)', (t) => {
      freeze(t);
      assert.equal(classifyCache(cachedAgo(-60_000)), 'fresh');
    });

    it('is expired when there is no usable cache (age Infinity)', () => {
      assert.equal(classifyCache(undefined), 'expired');
      assert.equal(classifyCache(null), 'expired');
      assert.equal(classifyCache({}), 'expired');
      assert.equal(classifyCache({ data: {} }), 'expired');
      assert.equal(classifyCache({ data: { computedAt: 'garbage' } }), 'expired');
    });
  });
});
