// Fetch a web page and extract its readable text for the coach to read.
//
// This is the pluggable seam for the link-attachment feature. Today it does a
// plain server-side fetch + Readability extraction, which nails server-rendered
// pages (articles, docs, blogs, news) but returns little for pure
// client-rendered SPAs. To upgrade fidelity later ("as a human sees it" for any
// page), replace ONLY the fetch step in `fetchUrlContent` with a JS renderer
// (headless browser or a reader service) — `extractReadable` and the route stay
// the same.

import { fetch as undiciFetch, Agent } from 'undici';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { assertSafeUrl, assertSafeHost, safeLookup, LinkError } from './url-guard.js';

// Fetch agent whose connection-time DNS lookup validates the resolved address
// and connects to that exact IP — closing the DNS-rebinding TOCTOU gap (a host
// can't pass an up-front check then re-resolve to an internal IP at connect).
// Uses undici's own fetch so the dispatcher is guaranteed compatible (mixing
// Node's internal fetch with an external undici Agent throws). Indirected
// through `_net` so tests can stub the network without real requests.
const safeAgent = new Agent({ connect: { lookup: safeLookup } });
export const _net = {
  fetch: (url, opts) => undiciFetch(url, { ...opts, dispatcher: safeAgent }),
};

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB cap on the downloaded HTML
const MAX_TEXT_CHARS = 50_000; // bound the text injected into the AI payload
const MAX_REDIRECTS = 5;
const USER_AGENT = 'platoLinkFetcher/1.0 (+https://github.com/1111philo/plato)';
const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

const BLOCK_SELECTOR = 'p,div,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,section,article,header,footer,ul,ol,table';

// Convert an HTML fragment to plain text via the DOM, preserving block
// boundaries. We read text from parsed nodes (`textContent`) rather than
// stripping tags from the string with regex: regex tag-removal is provably
// incomplete (e.g. `<scr<script>ipt>`) and `textContent` also decodes HTML
// entities for free. Block boundaries matter because Readability's own
// `textContent` fuses elements — "<h1>Hi</h1><p>Yo</p>" → "HiYo" — which
// mangles words for the model. Input is serialized DOM (Readability output or
// an element's innerHTML), so wrapping it in a body parses cleanly.
function domToText(htmlFragment) {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${htmlFragment || ''}</body></html>`);
  const body = document.body;
  if (!body) return '';
  body.querySelectorAll('script,style,noscript,template,svg').forEach((n) => n.remove());
  body.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  body.querySelectorAll('li').forEach((el) => el.prepend('• '));
  body.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.append('\n'));
  return (body.textContent || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Extract a readable title + text from raw HTML. Pure (no network) so it's
 * unit-testable on its own. Falls back to a whole-body strip when Readability
 * declines to parse (non-article pages).
 */
export function extractReadable(html) {
  let title = null;
  let siteName = null;
  let text = '';

  try {
    const { document } = parseHTML(html); // Readability mutates this document
    const article = new Readability(document).parse();
    if (article && article.content) {
      title = article.title || null;
      siteName = article.siteName || null;
      text = domToText(article.content);
    }
  } catch {
    // fall through to the whole-body fallback
  }

  if (!text.trim()) {
    const { document } = parseHTML(html); // fresh parse — the first was mutated
    title = title || document.querySelector('title')?.textContent?.trim() || null;
    text = domToText(document.body?.innerHTML || '');
  }

  return { title, siteName, text: text.trim() };
}

// Read a Response body, aborting if it exceeds maxBytes (defends against a
// huge/streaming response slipping past a missing Content-Length).
async function readCappedText(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new LinkError('too_large', 'That page is too large to read.', 413);
    return buf.toString('utf-8');
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new LinkError('too_large', 'That page is too large to read.', 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Fetch a URL safely and return its readable content.
 * @returns {Promise<{url, finalUrl, title, siteName, text, truncated}>}
 * @throws {LinkError} on validation/SSRF (400), fetch failure (502), etc.
 */
export async function fetchUrlContent(url) {
  let current = assertSafeUrl(url);
  await assertSafeHost(current.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let res;
    // Follow redirects manually so every hop is re-validated against the SSRF
    // guard — `redirect: 'follow'` would let a public URL bounce to an internal
    // one. The agent's pinned lookup is the connection-time authority; this
    // per-hop `assertSafeHost` is a cheap fast-fail and covers literal-IP hosts
    // (which skip the agent's lookup).
    for (let hop = 0; ; hop++) {
      res = await _net.fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain' },
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) throw new LinkError('too_many_redirects', 'That link redirected too many times.');
      const next = assertSafeUrl(new URL(location, current).href);
      await assertSafeHost(next.hostname);
      current = next;
    }

    if (!res.ok) {
      throw new LinkError('fetch_failed', `That page returned an error (${res.status}).`, 502);
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
      throw new LinkError('unsupported_type', "That link isn't a readable web page.", 415);
    }
    const declaredLength = Number(res.headers.get('content-length'));
    if (declaredLength && declaredLength > MAX_BYTES) {
      throw new LinkError('too_large', 'That page is too large to read.', 413);
    }

    const html = await readCappedText(res, MAX_BYTES);
    const { title, siteName, text } = extractReadable(html);
    const truncated = text.length > MAX_TEXT_CHARS;
    return {
      url,
      finalUrl: current.href,
      title: title || current.hostname,
      siteName,
      text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
      truncated,
    };
  } catch (e) {
    if (e instanceof LinkError) throw e;
    if (e?.name === 'AbortError') throw new LinkError('timeout', 'That page took too long to load.', 504);
    throw new LinkError('fetch_failed', "Couldn't load that link.", 502);
  } finally {
    clearTimeout(timer);
  }
}

export const _internals = { domToText, MAX_TEXT_CHARS };
