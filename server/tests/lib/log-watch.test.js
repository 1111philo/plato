/**
 * The data-loss alarm (scripts/log-watch.js): write-path sync errors and
 * refused oversize records both page.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dataLossGroups } from '../../../scripts/log-watch.js';

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
