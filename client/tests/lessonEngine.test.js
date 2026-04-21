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

const { assertImageWithinBedrockLimit } = await import('../src/lib/lessonEngine.js');

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
