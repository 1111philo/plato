import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { traceScopeKey } from '../js/traceScope.js';
import { traceKey } from '../src/lib/lessonTrace.js';

// The server's rule for a trace key (server/src/routes/sync.js VALID_DATA_KEYS).
const SERVER_TRACE_KEY = /^trace:[A-Za-z0-9_-]{1,120}:[tbp]:[A-Za-z0-9]{1,64}$/;

describe('traceScopeKey', () => {
  it('leaves a safe scope as it is, so traces recorded before keep their keys', () => {
    for (const s of ['foundations---technology-stack-fluency', 'profile', 'admin-1793473117138', 'getting-started']) assert.equal(traceScopeKey(s), s);
  });
  it('makes any lesson id a key the server accepts, the same every time, and different ids different keys', () => {
    // Lesson ids seen on playground, whose traces the server refused (2026-11-24).
    const ids = ['foundations-4---prioritization-&-self-management', 'foundations:-technology-stack-fluency', 'Foundations 1 - Professional Identity', ':', '&', 'é', 'x'.repeat(300)];
    const keys = ids.map((id) => traceKey(id, 't', '1795544473372'));
    for (const k of keys) assert.match(k, SERVER_TRACE_KEY, k);
    assert.deepEqual(ids.map((id) => traceKey(id, 't', '1795544473372')), keys, 'stable');
    assert.equal(new Set(keys).size, keys.length, 'distinct');
    assert.match(traceScopeKey('foundations-4---prioritization-&-self-management'), /^foundations-4---prioritization---self-management_[0-9a-f]{16}$/, 'still readable');
  });
});
