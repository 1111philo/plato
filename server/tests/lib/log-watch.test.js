/**
 * The data-loss alarm (scripts/log-watch.js): write-path sync errors and
 * refused oversize records both page.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dataLossGroups, buildIssueBody } from '../../../scripts/log-watch.js';

describe('dataLossGroups', () => {
  it('flags failed sync writes and oversize records, nothing else', () => {
    const groups = [
      { code: 'unhandled_error', sample: { meta: { method: 'PUT', path: '/v1/sync/messages:x' } } },
      { code: 'unhandled_error', sample: { meta: { method: 'GET', path: '/v1/sync' } } },
      { code: 'sync_item_too_large', sample: { meta: { dataKey: 'messages' } } },
      { code: 'job_failed' },
    ];
    assert.deepEqual(dataLossGroups({ groups }).map((g) => g.code), ['unhandled_error', 'sync_item_too_large']);
  });
});

describe('buildIssueBody', () => {
  it('describes both kinds of group, with no undefined fields', () => {
    const hits = [
      { code: 'unhandled_error', count: 2, firstSeen: 't0', lastSeen: 't1', sample: { meta: { method: 'PUT', path: '/v1/sync/messages:x', error: 'boom' } } },
      { code: 'sync_item_too_large', count: 1, firstSeen: 't0', lastSeen: 't1', sample: { meta: { dataKey: 'messages', size: 400000, limit: 389120 } } },
    ];
    const body = buildIssueBody({ windowHours: 24 }, hits, 3);
    assert.match(body, /`PUT \/v1\/sync\/messages:x` — _boom_/);
    assert.match(body, /`messages:\*` — _400000 bytes, over the 389120-byte limit_/);
    assert.doesNotMatch(body, /undefined/);
  });
});
