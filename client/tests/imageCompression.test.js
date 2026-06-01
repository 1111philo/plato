/**
 * Tests for imageCompression — the pure / fallback paths.
 *
 * The actual canvas re-encoding needs a DOM (jsdom-free Node test runner has
 * no `document`/`Image`), so `compressImageDataUrl` is exercised here only
 * for its no-op fallbacks. The contract that matters: it ALWAYS resolves to
 * a usable data URL and never throws — a too-large image is a degraded case,
 * not an error.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { estimateDataUrlBytes, compressImageDataUrl } = await import('../src/lib/imageCompression.js');

describe('estimateDataUrlBytes', () => {
  it('returns 0 for non-string input', () => {
    assert.equal(estimateDataUrlBytes(null), 0);
    assert.equal(estimateDataUrlBytes(undefined), 0);
    assert.equal(estimateDataUrlBytes(42), 0);
  });

  it('estimates decoded size from the base64 body (3 bytes per 4 chars)', () => {
    // 400 base64 chars after the comma -> 300 bytes.
    const dataUrl = `data:image/png;base64,${'A'.repeat(400)}`;
    assert.equal(estimateDataUrlBytes(dataUrl), 300);
  });

  it('handles a raw base64 string with no data: prefix', () => {
    assert.equal(estimateDataUrlBytes('A'.repeat(8)), 6);
  });
});

describe('compressImageDataUrl (fallback paths)', () => {
  it('returns non-image input unchanged', async () => {
    assert.equal(await compressImageDataUrl('not a data url'), 'not a data url');
    assert.equal(await compressImageDataUrl(null), null);
  });

  it('returns the original data URL when no DOM is available', async () => {
    // Node test env has no `document` — the function must degrade, not throw.
    const dataUrl = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;
    const out = await compressImageDataUrl(dataUrl);
    assert.equal(out, dataUrl);
  });

  it('never throws', async () => {
    await assert.doesNotReject(() => compressImageDataUrl('data:image/jpeg;base64,zzz'));
  });

  it('returns null for an oversized image that fails to decode', async () => {
    // Force the catch path by stubbing a DOM whose Image always errors, then
    // hand it an oversized "image" data URL. The original is too large to keep,
    // so the result must be null — not the oversized original — so ComposeBar
    // warns the user upfront rather than letting the server reject with a 413.
    const savedDocument = globalThis.document;
    const savedImage = globalThis.Image;
    globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
    globalThis.Image = class {
      set src(_v) {
        Promise.resolve().then(() => this.onerror?.(new Error('decode failed')));
      }
    };
    try {
      const oversized = `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}`;
      assert.equal(await compressImageDataUrl(oversized), null);
    } finally {
      globalThis.document = savedDocument;
      globalThis.Image = savedImage;
    }
  });
});
