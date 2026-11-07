/**
 * Typed AI errors and backoff (#451 scale review, H3): the server's codes map
 * to error types with accurate messages, and retries wait with jitter.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, parseSSEStream, backoffMs, isRetryable, ApiError } from '../js/api.js';

const jsonResp = (status, body, headers = {}) => ({
  ok: status < 400, status, headers: new Headers(headers), json: async () => body,
});

function sse(lines) {
  const enc = new TextEncoder();
  const chunks = lines.map((l) => enc.encode(`data: ${l}\n\n`));
  let i = 0;
  return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }), releaseLock() {} }) };
}

describe('parseResponse: typed errors', () => {
  it('a throttle or rate limit is rate_limit with the wait, and an honest message', async () => {
    for (const code of ['throttled', 'rate_limited']) {
      const e = await parseResponse(jsonResp(429, { error: 'x', code, retryAfterMs: 4000 })).catch((x) => x);
      assert.ok(e instanceof ApiError);
      assert.deepEqual([e.type, e.status, e.retryAfterMs], ['rate_limit', 429, 4000]);
      assert.equal(e.message, 'plato is busy right now. Try again in 4 seconds.');
    }
  });
  it('overloaded and timeout; a Retry-After header is used when the body has no wait', async () => {
    const o = await parseResponse(jsonResp(503, { code: 'overloaded' }, { 'retry-after': '6' })).catch((x) => x);
    assert.deepEqual([o.type, o.retryAfterMs], ['overloaded', 6000]);
    assert.doesNotMatch(o.message, /Retrying/, 'never says it retries when it may not');
    const t = await parseResponse(jsonResp(504, { code: 'timeout' })).catch((x) => x);
    assert.equal(t.type, 'timeout');
  });
});

describe('parseSSEStream: a typed error event', () => {
  it('carries the type and wait', async () => {
    const body = sse([JSON.stringify({ type: 'error', error: { message: 'x', code: 'throttled', retryAfterMs: 3000 } })]);
    const e = await (async () => { for await (const _ of parseSSEStream(body)) { /* drain */ } })().catch((x) => x);
    assert.deepEqual([e.type, e.retryAfterMs], ['rate_limit', 3000]);
    const plain = sse([JSON.stringify({ type: 'error', error: { message: 'x' } })]);
    const p = await (async () => { for await (const _ of parseSSEStream(plain)) { /* drain */ } })().catch((x) => x);
    assert.equal(p.message, 'The response failed partway through. Please try again.');
  });
});

describe('backoffMs and isRetryable', () => {
  it('waits at least the server’s retryAfter, grows exponentially, and adds up to 50% jitter', () => {
    assert.equal(backoffMs(0, undefined, { rand: () => 0 }), 2000);
    assert.equal(backoffMs(1, undefined, { rand: () => 0 }), 4000);
    assert.equal(backoffMs(0, 9000, { rand: () => 0 }), 9000);
    assert.equal(backoffMs(0, undefined, { rand: () => 1 }), 3000);
  });
  it('retries busy, rate-limited, timed-out and 5xx; not auth or bad requests', () => {
    for (const e of [{ type: 'rate_limit' }, { type: 'overloaded' }, { type: 'timeout' }, { type: 'api', status: 502 }]) assert.equal(isRetryable(e), true);
    for (const e of [{ type: 'invalid_key' }, { type: 'api', status: 400 }, { type: 'parse' }]) assert.equal(isRetryable(e), false);
  });
});
