/**
 * Tests for the "stick to bottom" logic behind the chat log (#319).
 *
 * Behavior: if the reader is at the bottom when content is added, keep them
 * there; if they've scrolled up, don't move them; if they send a message, jump
 * to the bottom regardless.
 *
 * These cover the pure decision layer — which elements to act on, whether the
 * reader counts as "at the bottom", and what counts as a new user message. The
 * event wiring (capturing `window` listener, MutationObserver, ResizeObserver)
 * needs a real browser and is verified by hand.
 *
 * Two regression guards worth keeping in mind while reading:
 *   - #321 attached its listener to the chat log element, which has no
 *     `overflow` and never scrolls, so its readings were always identical.
 *   - Acting on a single guessed scroller makes `scrollTop` a silent no-op when
 *     the guess is wrong, which is indistinguishable from no feature at all.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalDoc = globalThis.document;
const originalWindow = globalThis.window;

/**
 * Stub the document scroller and window viewport.
 * @param {{scrollHeight:number, scrollY:number, innerHeight:number}} opts
 */
function stubDocument({ scrollHeight, scrollY, innerHeight }) {
  const documentElement = { scrollHeight, __name: 'html' };
  const body = { __name: 'body' };
  // In standards mode the browser's scrollingElement *is* documentElement.
  globalThis.document = { documentElement, body, scrollingElement: documentElement };
  globalThis.window = { scrollY, innerHeight };
  return { documentElement, body };
}

/** An element-style scroller (e.g. `<main class="overflow-y-auto">`). */
function elementScroller({ scrollHeight, scrollTop, clientHeight }) {
  return { scrollHeight, scrollTop, clientHeight, nodeType: 1 };
}

beforeEach(() => {
  stubDocument({ scrollHeight: 2000, scrollY: 0, innerHeight: 800 });
});

afterEach(() => {
  globalThis.document = originalDoc;
  globalThis.window = originalWindow;
});

const {
  distanceFromBottom, isAtBottom, containsNewUserMessage, scrollToBottom,
  collectScrollers, computeAtBottom, isOverflowing, BOTTOM_EPSILON,
} = await import('../src/hooks/useStickToBottom.js');

/** Fake DOM element with just the two methods the detector calls. */
function el({ matches = false, contains = false } = {}) {
  return {
    nodeType: 1,
    matches: () => matches,
    querySelector: () => (contains ? { nodeType: 1 } : null),
  };
}

/** A childList MutationRecord carrying the given added nodes. */
const added = (...addedNodes) => ({ type: 'childList', addedNodes });

describe('distanceFromBottom — element scroller (<main class="overflow-y-auto">)', () => {
  it('measures remaining scroll distance', () => {
    // 2000px of content in a 500px window, scrolled to 1000 → 500px left below.
    const main = elementScroller({ scrollHeight: 2000, scrollTop: 1000, clientHeight: 500 });
    assert.equal(distanceFromBottom(main), 500);
  });

  it('reports zero at the exact bottom', () => {
    const main = elementScroller({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 });
    assert.equal(distanceFromBottom(main), 0);
  });

  it('reports zero for content that does not overflow', () => {
    const main = elementScroller({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 });
    assert.equal(distanceFromBottom(main), 0);
  });
});

describe('distanceFromBottom — document scroller', () => {
  it('measures the window when passed the document scroller', () => {
    stubDocument({ scrollHeight: 2000, scrollY: 1200, innerHeight: 800 });
    assert.equal(distanceFromBottom(globalThis.document.documentElement), 0);
  });

  it('measures the window when passed null (scroll event on document)', () => {
    stubDocument({ scrollHeight: 2000, scrollY: 700, innerHeight: 800 });
    assert.equal(distanceFromBottom(null), 500);
  });

  it('treats document, documentElement and body as the same scroller', () => {
    stubDocument({ scrollHeight: 3000, scrollY: 1000, innerHeight: 800 });
    const { documentElement, body } = globalThis.document;
    const expected = 3000 - 1000 - 800;
    assert.equal(distanceFromBottom(globalThis.document), expected);
    assert.equal(distanceFromBottom(documentElement), expected);
    assert.equal(distanceFromBottom(body), expected);
  });
});

describe('isAtBottom', () => {
  it('is true at the bottom and false when scrolled up', () => {
    const bottom = elementScroller({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 });
    const scrolledUp = elementScroller({ scrollHeight: 2000, scrollTop: 600, clientHeight: 500 });
    assert.equal(isAtBottom(bottom), true);
    assert.equal(isAtBottom(scrolledUp), false);
  });

  it('tolerates sub-pixel/rounding gaps at the bottom', () => {
    // Fractional layout heights mean "at bottom" rarely lands on exactly 0.
    const nearlyBottom = elementScroller({ scrollHeight: 2000.4, scrollTop: 1499.7, clientHeight: 500 });
    assert.equal(isAtBottom(nearlyBottom), true);
  });

  it('is true exactly at the epsilon boundary and false one px beyond', () => {
    const atEdge = elementScroller({
      scrollHeight: 2000, scrollTop: 1500 - BOTTOM_EPSILON, clientHeight: 500,
    });
    const pastEdge = elementScroller({
      scrollHeight: 2000, scrollTop: 1500 - BOTTOM_EPSILON - 1, clientHeight: 500,
    });
    assert.equal(isAtBottom(atEdge), true);
    assert.equal(isAtBottom(pastEdge), false);
  });

  it('does not treat a deliberate scroll up as being at the bottom', () => {
    // One 100px wheel notch must unstick — the old 50px window swallowed it.
    const oneNotchUp = elementScroller({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 500 });
    assert.equal(isAtBottom(oneNotchUp), false);
  });

  it('accepts a custom epsilon', () => {
    const s = elementScroller({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 500 });
    assert.equal(distanceFromBottom(s), 100);
    assert.equal(isAtBottom(s, 150), true);
    assert.equal(isAtBottom(s, 50), false);
  });

  it('is true for a short conversation that cannot scroll at all', () => {
    // No overflow yet → the reader is trivially at the bottom, so the first
    // streamed reply must still keep them pinned.
    const s = elementScroller({ scrollHeight: 300, scrollTop: 0, clientHeight: 800 });
    assert.equal(isAtBottom(s), true);
  });
});

describe('collectScrollers', () => {
  const originalGCS = globalThis.getComputedStyle;

  /** Chain of ancestors, innermost first, each with an overflowY. */
  function chain(...overflows) {
    const nodes = overflows.map(overflowY => ({ overflowY, parentElement: null, nodeType: 1 }));
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].parentElement = nodes[i + 1];
    return nodes;
  }

  beforeEach(() => {
    globalThis.getComputedStyle = el => ({ overflowY: el.overflowY ?? 'visible' });
  });
  afterEach(() => { globalThis.getComputedStyle = originalGCS; });

  it('collects the scrollable ancestor, skipping non-scrolling ones', () => {
    // Mirrors the live tree: log div -> wrapper -> <main class="overflow-y-auto">
    const [log, , main] = chain('visible', 'visible', 'auto');
    assert.deepEqual(collectScrollers({ parentElement: log }), [main]);
  });

  it('collects every scrollable ancestor, not just the nearest', () => {
    // Which one is the real scrollport depends on the flex chain, so all of
    // them must be returned — picking one and being wrong is a silent no-op.
    const [log, inner, , outer] = chain('visible', 'auto', 'visible', 'scroll');
    assert.deepEqual(collectScrollers({ parentElement: log }), [inner, outer]);
  });

  it('includes a scroller that has not overflowed yet (empty chat)', () => {
    const [log, main] = chain('visible', 'auto');
    Object.assign(main, { scrollHeight: 400, clientHeight: 400 });
    assert.deepEqual(collectScrollers({ parentElement: log }), [main]);
  });

  it('accepts auto/scroll/overlay and rejects hidden/visible/clip', () => {
    for (const overflowY of ['auto', 'scroll', 'overlay']) {
      const [inner, outer] = chain('visible', overflowY);
      assert.deepEqual(collectScrollers({ parentElement: inner }), [outer], overflowY);
    }
    for (const overflowY of ['hidden', 'visible', 'clip']) {
      const [inner] = chain('visible', overflowY);
      assert.deepEqual(collectScrollers({ parentElement: inner }), [], overflowY);
    }
  });

  it('returns empty when nothing scrolls (document is the scrollport)', () => {
    const [inner] = chain('visible', 'visible');
    assert.deepEqual(collectScrollers({ parentElement: inner }), []);
  });

  it('tolerates a detached or missing node', () => {
    assert.deepEqual(collectScrollers(null), []);
    assert.deepEqual(collectScrollers({ parentElement: null }), []);
  });
});

describe('scrollToBottom', () => {
  it('drives scrollTop to the full scroll height, not to a sentinel', () => {
    // The compose bar lives inside the scroll container, below the chat log, so
    // aligning a sentinel to the scrollport bottom stops short by the compose
    // height. Requesting scrollHeight lets the browser clamp to the true max.
    const main = elementScroller({ scrollHeight: 2000, scrollTop: 300, clientHeight: 500 });
    globalThis.window.scrollTo = () => {};
    scrollToBottom([main]);
    assert.equal(main.scrollTop, 2000);
  });

  it('pins every candidate scroller, so a wrong guess cannot no-op', () => {
    // Setting scrollTop on an element that isn't the scrollport does nothing and
    // reports no error, so every candidate must be written to.
    const a = elementScroller({ scrollHeight: 2000, scrollTop: 0, clientHeight: 500 });
    const b = elementScroller({ scrollHeight: 900, scrollTop: 0, clientHeight: 300 });
    globalThis.window.scrollTo = () => {};
    scrollToBottom([a, b]);
    assert.equal(a.scrollTop, 2000);
    assert.equal(b.scrollTop, 900);
  });

  it('also scrolls the window, since the document may be the scrollport', () => {
    stubDocument({ scrollHeight: 4000, scrollY: 0, innerHeight: 800 });
    const calls = [];
    globalThis.window.scrollTo = (opts) => calls.push(opts);
    scrollToBottom([]);
    assert.deepEqual(calls, [{ top: 4000, behavior: 'auto' }]);
  });

  it('uses instant scrolling, never smooth', () => {
    // A smooth animation restarted on every stream tick never settles and reads
    // as the page fighting the wheel.
    stubDocument({ scrollHeight: 4000, scrollY: 0, innerHeight: 800 });
    const calls = [];
    globalThis.window.scrollTo = (opts) => calls.push(opts);
    scrollToBottom([]);
    assert.equal(calls[0].behavior, 'auto');
  });

  it('does not throw on an empty candidate list', () => {
    globalThis.window.scrollTo = () => {};
    assert.doesNotThrow(() => scrollToBottom([]));
    assert.doesNotThrow(() => scrollToBottom());
  });
});

describe('isOverflowing', () => {
  it('is true only when content exceeds the box', () => {
    assert.equal(isOverflowing(elementScroller({ scrollHeight: 2000, scrollTop: 0, clientHeight: 500 })), true);
    assert.equal(isOverflowing(elementScroller({ scrollHeight: 500, scrollTop: 0, clientHeight: 500 })), false);
  });

  it('ignores sub-pixel differences and missing elements', () => {
    assert.equal(isOverflowing(elementScroller({ scrollHeight: 500.5, scrollTop: 0, clientHeight: 500 })), false);
    assert.equal(isOverflowing(null), false);
  });
});

describe('computeAtBottom', () => {
  it('judges by the overflowing scroller, ignoring ones that fit', () => {
    // A container that does not overflow reports distance 0; counting it would
    // read as "at bottom" forever and scrolling up would never unstick.
    stubDocument({ scrollHeight: 800, scrollY: 0, innerHeight: 800 });
    const fits = elementScroller({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 });
    const scrolledUp = elementScroller({ scrollHeight: 2000, scrollTop: 600, clientHeight: 500 });
    assert.equal(computeAtBottom([fits, scrolledUp]), false);
  });

  it('is true when the overflowing scroller sits at its bottom', () => {
    stubDocument({ scrollHeight: 800, scrollY: 0, innerHeight: 800 });
    const atBottom = elementScroller({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 });
    assert.equal(computeAtBottom([atBottom]), true);
  });

  it('falls back to the document when no candidate overflows', () => {
    stubDocument({ scrollHeight: 3000, scrollY: 2200, innerHeight: 800 });
    assert.equal(computeAtBottom([]), true);
    stubDocument({ scrollHeight: 3000, scrollY: 500, innerHeight: 800 });
    assert.equal(computeAtBottom([]), false);
  });

  it('is true when nothing scrolls at all (short conversation)', () => {
    // Trivially at the bottom, so the first streamed reply must still pin.
    stubDocument({ scrollHeight: 800, scrollY: 0, innerHeight: 800 });
    assert.equal(computeAtBottom([]), true);
  });

  it('requires both element and document to be at bottom when both scroll', () => {
    stubDocument({ scrollHeight: 3000, scrollY: 500, innerHeight: 800 });
    const atBottom = elementScroller({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 });
    // Element is pinned but the page itself is scrolled up -> not at bottom.
    assert.equal(computeAtBottom([atBottom]), false);
  });
});

describe('containsNewUserMessage', () => {
  it('detects the user message element added directly', () => {
    assert.equal(containsNewUserMessage(added(el({ matches: true }))), true);
  });

  it('detects a user message nested in an added wrapper', () => {
    // LessonChat wraps the message in a <div> with any images/links, so the
    // marked node arrives as a descendant, not as the added node itself.
    assert.equal(containsNewUserMessage(added(el({ contains: true }))), true);
  });

  it('ignores added nodes with no user message (coach reply)', () => {
    assert.equal(containsNewUserMessage(added(el())), false);
  });

  it('ignores characterData mutations (streaming text)', () => {
    // The coach's text growing must not be mistaken for the learner sending —
    // otherwise every stream tick would yank a scrolled-up reader down.
    const record = { type: 'characterData', addedNodes: [el({ matches: true })] };
    assert.equal(containsNewUserMessage(record), false);
  });

  it('ignores text nodes, which cannot carry the marker', () => {
    // Text nodes have no matches/querySelector — must not throw.
    const textNode = { nodeType: 3 };
    assert.equal(containsNewUserMessage(added(textNode)), false);
  });

  it('handles an empty mutation', () => {
    assert.equal(containsNewUserMessage(added()), false);
  });

  it('detects a user message among several added nodes', () => {
    assert.equal(containsNewUserMessage(added(el(), el({ matches: true }), el())), true);
  });
});
