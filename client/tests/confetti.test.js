/**
 * Completion confetti respects prefers-reduced-motion (#451 third review:
 * the only reduced-motion check lived in the removed typing reveal).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { launchConfetti, prefersReducedMotion } = await import('../src/lib/confetti.js');

describe('confetti and reduced motion', () => {
  afterEach(() => { delete globalThis.window; delete globalThis.document; });

  it('reads the media query, and is false without one', () => {
    assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
    assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
    assert.equal(prefersReducedMotion(undefined), false);
  });

  it('skips the burst entirely under reduced motion', () => {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    globalThis.document = { getElementById() { throw new Error('touched the DOM'); } };
    assert.equal(launchConfetti(), false);
  });

  it('runs otherwise', () => {
    const appended = [];
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    globalThis.document = {
      getElementById: () => ({ appendChild: (el) => appended.push(el) }),
      createElement: () => ({ style: { setProperty() {} }, addEventListener() {} }),
      body: null,
    };
    assert.equal(launchConfetti(), true);
    assert.ok(appended.length > 0);
  });
});
