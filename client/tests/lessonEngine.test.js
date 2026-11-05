/**
 * Tests for lessonEngine helpers.
 *
 * Stubs browser globals (localStorage, fetch) before importing the module so
 * its storage/orchestrator dependencies load cleanly in Node's test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
globalThis.fetch = async () => ({ ok: false, status: 404 });

const { assertImageWithinBedrockLimit, normalizeImageDataUrls, recoverMissingTags, parseCoachResponse } = await import('../src/lib/lessonEngine.js');

// Build a data URL whose base64 body decodes (per length*3/4) to exactly
// `bytes` bytes. The guard uses the same math so the round-trip is exact.
// `bytes` must be a multiple of 3.
function imageDataUrlOfSize(bytes) {
  if (bytes % 3 !== 0) throw new Error('test helper expects multiple of 3');
  const b64Len = (bytes / 3) * 4;
  return `data:image/png;base64,${'A'.repeat(b64Len)}`;
}

const MAX = 5 * 1024 * 1024;

describe('assertImageWithinBedrockLimit', () => {
  it('does not throw for undefined or empty input', () => {
    assert.doesNotThrow(() => assertImageWithinBedrockLimit(undefined));
    assert.doesNotThrow(() => assertImageWithinBedrockLimit(null));
    assert.doesNotThrow(() => assertImageWithinBedrockLimit(''));
  });

  it('does not throw for non-image or non-base64 URLs', () => {
    assert.doesNotThrow(() => assertImageWithinBedrockLimit('https://example.com/foo.png'));
    assert.doesNotThrow(() => assertImageWithinBedrockLimit('data:text/plain;base64,SGVsbG8='));
  });

  it('accepts images at or below the 5 MB Bedrock limit', () => {
    // MAX (5 * 1024 * 1024 = 5242880) is not divisible by 3; use MAX - 2 which is.
    assert.doesNotThrow(() => assertImageWithinBedrockLimit(imageDataUrlOfSize(3 * 1024)));
    assert.doesNotThrow(() => assertImageWithinBedrockLimit(imageDataUrlOfSize(MAX - 2)));
  });

  it('throws a learner-friendly error above 5 MB', () => {
    // Next multiple of 3 above MAX: 5242881.
    const oversized = imageDataUrlOfSize(6 * 1024 * 1024);
    assert.throws(
      () => assertImageWithinBedrockLimit(oversized),
      /Image is too large \(6\.\d MB\)\. Please resize it to under 5 MB/
    );
  });

  it('catches the CloudWatch case (~5.38 MB > 5 MB)', () => {
    // Matches the CloudWatch ValidationException that motivated this guard:
    // "image exceeds 5 MB maximum: 5639060 bytes > 5242880 bytes".
    // Round to the nearest multiple of 3 (5639061) for the test encoder.
    const oversized = imageDataUrlOfSize(5639061);
    assert.throws(() => assertImageWithinBedrockLimit(oversized), /Image is too large/);
  });
});

describe('normalizeImageDataUrls', () => {
  it('returns an empty array for null / undefined / empty string', () => {
    assert.deepEqual(normalizeImageDataUrls(null), []);
    assert.deepEqual(normalizeImageDataUrls(undefined), []);
    assert.deepEqual(normalizeImageDataUrls(''), []);
  });

  it('wraps a single string in an array (backward compat)', () => {
    assert.deepEqual(
      normalizeImageDataUrls('data:image/png;base64,AAA'),
      ['data:image/png;base64,AAA']
    );
  });

  it('passes an array through unchanged when all entries are truthy', () => {
    const arr = ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB'];
    assert.deepEqual(normalizeImageDataUrls(arr), arr);
  });

  it('filters nullish entries out of arrays', () => {
    assert.deepEqual(
      normalizeImageDataUrls(['data:image/png;base64,AAA', null, '', undefined, 'data:image/png;base64,BBB']),
      ['data:image/png;base64,AAA', 'data:image/png;base64,BBB']
    );
  });

  it('returns an empty array for an empty input array', () => {
    assert.deepEqual(normalizeImageDataUrls([]), []);
  });
});

// Testers saw the coach say "you've met all three" while nothing was recorded:
// the reply had no tags. recoverMissingTags asks for them (#451 tester QA).
describe('recoverMissingTags', () => {
  const noTags = parseCoachResponse('You have covered all three objectives. Well done.');
  it('leaves a reply that has its tags alone, without asking', async () => {
    let asked = false;
    const tagged = parseCoachResponse('Good.\n\n[PROGRESS: 4]');
    const r = await recoverMissingTags(tagged, async () => { asked = true; return ''; });
    assert.equal(asked, false);
    assert.deepEqual([r.progress, r.tagsRecovered], [4, false]);
  });
  it('fills in progress, the KB update, and the profile update from the repair', async () => {
    const r = await recoverMissingTags(noTags, async () => '[PROGRESS: 10]\n[KB_UPDATE: {"insights": ["x"], "objectivesMet": [1, 2, 3]}]\n[PROFILE_UPDATE: {"observation": "y"}]');
    assert.equal(r.progress, 10);
    assert.deepEqual(r.kbUpdate.objectivesMet, [1, 2, 3]);
    assert.equal(r.profileUpdate.observation, 'y');
    assert.equal(r.tagsRecovered, true);
    assert.equal(r.text, noTags.text, 'the learner-visible text is unchanged');
  });
  it('never throws: a failed or tagless repair keeps the reply as it was', async () => {
    for (const repair of [async () => { throw new Error('boom'); }, async () => 'no tags here']) {
      const r = await recoverMissingTags(noTags, repair);
      assert.deepEqual([r.progress, r.tagsRecovered], [null, false]);
    }
  });
});
