import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rangesExcluding } from '../../src/lib/key-ranges.js';

// What DynamoDB would return for the ranges, over a sorted set of keys.
function query(keys, prefixes) {
  const { ranges, excluded } = rangesExcluding(prefixes);
  const out = [];
  for (const { from, to, toInclusive } of ranges) {
    for (const k of keys) {
      if (from !== undefined && k < from) continue;
      if (to !== undefined && (toInclusive ? k > to : k >= to)) continue;
      out.push(k);
    }
  }
  return out.filter((k) => !excluded(k));
}

const KEYS = ['lessonKB:a', 'messages:a', 'profile', 'screenshot:', 'screenshot:k1', 'screenshot;', 'trace:', 'trace:a:t:1', 'trace:z:p:ff', 'trace;', 'tracer', 'userMeta:x', 'zebra'];

describe('rangesExcluding', () => {
  it('one prefix: everything else, each key once', () => {
    assert.deepEqual(query(KEYS, 'screenshot:').sort(), KEYS.filter((k) => !k.startsWith('screenshot:')).sort());
  });

  it('several prefixes, in any order: keys before, between and after survive; none twice', () => {
    for (const prefixes of [['screenshot:', 'trace:'], ['trace:', 'screenshot:'], ['trace:', 'screenshot:', 'trace:']]) {
      const got = query(KEYS, prefixes);
      assert.deepEqual([...got].sort(), KEYS.filter((k) => !k.startsWith('screenshot:') && !k.startsWith('trace:')).sort());
      assert.equal(new Set(got).size, got.length);
    }
  });

  it('adjacent prefixes leave no gap and no overlap', () => {
    const keys = ['a:1', 'b:1', 'c:1', 'b;', 'a;'];
    assert.deepEqual(query(keys, ['a:', 'b:']).sort(), ['a;', 'b;', 'c:1']);
  });
});
