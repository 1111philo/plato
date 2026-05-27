/**
 * Tests for markdown link rendering in helpers.renderMd, focused on the
 * XSS guard (isSafeUrl): coach/markdown output is untrusted, so only safe
 * protocols may become clickable anchors. A `javascript:` URL must render
 * as literal text, never an <a href>.
 *
 * helpers.esc() uses document.createElement, so we stub a minimal `document`
 * that mirrors the browser's textContent→innerHTML escaping (escapes & < >,
 * but NOT the URL scheme — which is exactly why the protocol allowlist, not
 * escaping, is the load-bearing defense).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  createElement: () => ({
    set textContent(v) { this._t = v; },
    get innerHTML() {
      return String(this._t)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    },
  }),
};

const { isSafeUrl, renderMd } = await import('../src/lib/helpers.js');

describe('isSafeUrl', () => {
  it('allows http(s) and mailto', () => {
    assert.equal(isSafeUrl('https://example.com'), true);
    assert.equal(isSafeUrl('http://example.com/path?q=1'), true);
    assert.equal(isSafeUrl('HTTPS://EXAMPLE.COM'), true);
    assert.equal(isSafeUrl('mailto:teacher@school.edu'), true);
  });

  it('rejects dangerous and unknown protocols', () => {
    assert.equal(isSafeUrl('javascript:alert(document.cookie)'), false);
    assert.equal(isSafeUrl('JaVaScRiPt:alert(1)'), false);
    assert.equal(isSafeUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(isSafeUrl('vbscript:msgbox(1)'), false);
    assert.equal(isSafeUrl('file:///etc/passwd'), false);
    assert.equal(isSafeUrl('relative/path'), false);
  });

  it('rejects leading-whitespace obfuscation', () => {
    assert.equal(isSafeUrl('  javascript:alert(1)'), false);
    // and still accepts a valid URL with stray leading space
    assert.equal(isSafeUrl(' https://example.com'), true);
  });
});

describe('renderMd markdown links', () => {
  it('renders a safe markdown link as an anchor', () => {
    const html = renderMd('See [the docs](https://example.com/docs).');
    assert.match(html, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener">the docs<\/a>/);
  });

  it('does NOT render a javascript: link as an anchor', () => {
    const html = renderMd('[click here](javascript:alert(document.cookie))');
    assert.doesNotMatch(html, /<a /);
    assert.doesNotMatch(html, /href="javascript:/i);
    // The original markdown text survives (no anchor injected).
    assert.match(html, /click here/);
  });

  it('does NOT render a data: link as an anchor', () => {
    const html = renderMd('[x](data:text/html,<script>alert(1)</script>)');
    assert.doesNotMatch(html, /<a /);
  });

  it('does not double-linkify an http(s) markdown link (no nested anchors)', () => {
    const html = renderMd('See [the docs](https://example.com/docs).');
    // Exactly one anchor, and no <a> nested inside an href attribute.
    assert.equal(html.match(/<a /g).length, 1);
    assert.doesNotMatch(html, /href="<a /);
    assert.match(html, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener">the docs<\/a>/);
  });

  it('still auto-linkifies a bare URL alongside a markdown link', () => {
    const html = renderMd('[docs](https://a.com) and bare https://b.com here');
    assert.equal(html.match(/<a /g).length, 2);
    assert.match(html, /<a href="https:\/\/a\.com"[^>]*>docs<\/a>/);
    assert.match(html, /<a href="https:\/\/b\.com"[^>]*>https:\/\/b\.com<\/a>/);
  });
});
