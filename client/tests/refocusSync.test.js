/** Refocus re-sync throttle (#451 scale review, B1). */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { shouldResyncOnRefocus, markFullSync, REFOCUS_SYNC_MS, _resetRefocusSync } from '../src/lib/refocusSync.js';

describe('refocus re-sync', () => {
  beforeEach(_resetRefocusSync);
  it('re-syncs at most once per REFOCUS_SYNC_MS, counting the initial load', () => {
    markFullSync(1_000);
    assert.equal(shouldResyncOnRefocus(1_000 + 10_000), false, 'just loaded');
    assert.equal(shouldResyncOnRefocus(1_000 + REFOCUS_SYNC_MS), true);
    assert.equal(shouldResyncOnRefocus(1_000 + REFOCUS_SYNC_MS + 5), false, 'just re-synced');
    assert.equal(shouldResyncOnRefocus(1_000 + 2 * REFOCUS_SYNC_MS + 5), true);
  });
});
