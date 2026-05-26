import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import links from '../../src/routes/links.js';
import { _net } from '../../src/lib/link-extractor.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const realNetFetch = _net.fetch;

async function authedReq(app, body) {
  const token = await signAccessToken('usr_test', 'user');
  return app.request('/v1/links/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
}

function htmlResponse(html, { status = 200, contentType = 'text/html' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
    body: null,
    arrayBuffer: async () => Buffer.from(html),
  };
}

const PAGE = '<html><head><title>Fetched Page</title></head><body><article><h1>Hi</h1>'
  + '<p>This is a sufficiently long paragraph of real content so the extractor keeps it as the main body text here.</p>'
  + '<p>And a second paragraph to clear the readability content threshold without trouble at all.</p></article></body></html>';

describe('POST /v1/links/fetch', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
  });
  afterEach(() => {
    _net.fetch = realNetFetch;
  });

  it('requires authentication', async () => {
    const app = new Hono();
    app.route('/', links);
    const res = await app.request('/v1/links/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(res.status, 401);
  });

  it('returns extracted text for a fetchable page', async () => {
    // Public IP literal → assertSafeHost passes without a DNS lookup.
    _net.fetch = async () => htmlResponse(PAGE);
    const app = new Hono();
    app.route('/', links);
    const res = await authedReq(app, { url: 'http://93.184.216.34/post' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.title, 'Fetched Page');
    assert.ok(data.text.includes('sufficiently long paragraph'));
    assert.equal(data.truncated, false);
  });

  it('400s a missing url', async () => {
    const app = new Hono();
    app.route('/', links);
    const res = await authedReq(app, {});
    assert.equal(res.status, 400);
  });

  it('400s an SSRF attempt at the metadata endpoint', async () => {
    const app = new Hono();
    app.route('/', links);
    const res = await authedReq(app, { url: 'http://169.254.169.254/latest/meta-data/' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'blocked_host');
  });

  it('400s a file:// scheme', async () => {
    const app = new Hono();
    app.route('/', links);
    const res = await authedReq(app, { url: 'file:///etc/passwd' });
    assert.equal(res.status, 400);
  });

  it('415s a non-HTML content type', async () => {
    _net.fetch = async () => htmlResponse('%PDF-1.7', { contentType: 'application/pdf' });
    const app = new Hono();
    app.route('/', links);
    const res = await authedReq(app, { url: 'http://93.184.216.34/file.pdf' });
    assert.equal(res.status, 415);
  });

  it('502s an upstream error response', async () => {
    _net.fetch = async () => htmlResponse('nope', { status: 500 });
    const app = new Hono();
    app.route('/', links);
    const res = await authedReq(app, { url: 'http://93.184.216.34/boom' });
    assert.equal(res.status, 502);
  });
});
