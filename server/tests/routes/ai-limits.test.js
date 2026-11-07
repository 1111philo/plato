/**
 * Limits on POST /v1/ai/messages (#451 scale review, B4/H3): request caps,
 * per-user rate and concurrency, and typed errors, including a throttle at
 * the start of a stream arriving as a real 429 instead of a 200 + SSE error.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import ai from '../../src/routes/ai.js';
import aiProvider from '../../src/lib/ai-provider.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import {
  validateAiRequest, acquire, classifyAiError, _resetAiLimits,
  MAX_MESSAGES, MAX_TOKENS_CAP, MAX_SYSTEM_CHARS, MAX_BODY_BYTES, RATE_PER_MINUTE, MAX_IN_FLIGHT,
} from '../../src/lib/ai-limits.js';

const M = 'qwen3-vl-235b';
const msg = (content = 'Hi', role = 'user') => ({ role, content });
const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
const app = () => { const a = new Hono(); a.route('/', ai); return a; };
async function post(body, userId = 'usr_lim') {
  const token = await signAccessToken(userId, 'learner');
  return app().request('/v1/ai/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetAiLimits();
  db.getUserById = async (id) => ({ userId: id, role: 'learner' });
  aiProvider.invoke = async () => ({ content: [{ type: 'text', text: 'ok' }], usage: {} });
});

describe('validateAiRequest', () => {
  it('accepts what plato sends, and defaults max_tokens', () => {
    const r = validateAiRequest({ model: M, system: 'x', messages: [msg(), msg('Ready.', 'assistant'), msg()] });
    assert.equal(r.error, undefined);
    assert.equal(r.aiBody.max_tokens, 1024);
    assert.equal(validateAiRequest({ model: M, max_tokens: MAX_TOKENS_CAP, messages: [msg()] }).error, undefined);
    // A coach tag repair: 43-message turn plus the reply and the cue, 4 images resent.
    const turn = [msg('ctx'), msg('Ready.', 'assistant'), ...Array.from({ length: 40 }, (_, i) => msg(`m${i}`, i % 2 ? 'assistant' : 'user')), { role: 'user', content: [{ type: 'text', text: 'see' }, img, img, img, img] }];
    assert.equal(validateAiRequest({ model: M, max_tokens: 600, messages: [...turn, msg('reply', 'assistant'), msg('Tags for your last reply.')] }).error, undefined);
  });

  it('refuses other models, oversized and malformed requests', () => {
    const bad = [
      { model: 'us.anthropic.claude-opus-5-5', messages: [msg()] },
      { model: M, max_tokens: MAX_TOKENS_CAP + 1, messages: [msg()] },
      { model: M, max_tokens: 1.5, messages: [msg()] },
      { model: M, messages: Array.from({ length: MAX_MESSAGES + 1 }, () => msg()) },
      { model: M, messages: [{ role: 'system', content: 'x' }] },
      { model: M, messages: [{ role: 'user', content: [img, img, img, img, img] }] },
      { model: M, messages: [{ role: 'user', content: [img, img, img, img] }, msg('a', 'assistant'), { role: 'user', content: [img, img, img, img] }, msg('b', 'assistant'), { role: 'user', content: [img] }] },
      { model: M, system: 'x'.repeat(MAX_SYSTEM_CHARS + 1), messages: [msg()] },
      { model: M, messages: [] },
    ];
    for (const b of bad) assert.ok(validateAiRequest(b).error, JSON.stringify(b).slice(0, 80));
    assert.equal(validateAiRequest({ model: M, messages: [msg()] }, MAX_BODY_BYTES + 1).status, 413);
  });
});

describe('per-user limits (per container)', () => {
  it(`allows ${RATE_PER_MINUTE} calls a minute, then says when to retry; refills over time`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_PER_MINUTE; i++) acquire('usr_r', t0).release();
    const no = acquire('usr_r', t0);
    assert.equal(no.ok, false);
    assert.equal(no.reason, 'rate');
    assert.ok(no.retryAfterMs > 0 && no.retryAfterMs <= 2000);
    assert.equal(acquire('usr_r', t0 + 2100).ok, true);
    assert.equal(acquire('usr_other', t0).ok, true, 'another user is unaffected');
  });

  it(`allows ${MAX_IN_FLIGHT} calls in flight; releasing frees a slot (once)`, () => {
    const held = Array.from({ length: MAX_IN_FLIGHT }, () => acquire('usr_f'));
    assert.equal(acquire('usr_f').reason, 'in_flight');
    held[0].release();
    held[0].release();
    assert.equal(acquire('usr_f').ok, true);
    assert.equal(acquire('usr_f').ok, false, 'a double release didn’t free two slots');
  });
});

describe('classifyAiError', () => {
  it('types Bedrock errors', () => {
    const t = classifyAiError({ name: 'ThrottlingException' });
    assert.deepEqual([t.status, t.code], [429, 'throttled']);
    assert.ok(t.retryAfterMs > 0);
    assert.equal(classifyAiError({ name: 'ServiceUnavailableException' }).code, 'overloaded');
    assert.equal(classifyAiError(new Error('Bedrock stream timed out after 115000ms')).code, 'timeout');
    assert.equal(classifyAiError(new Error('ValidationException')).code, 'failed');
  });
});

describe('POST /v1/ai/messages limits', () => {
  it('rejects malformed JSON and a body over the size cap', async () => {
    assert.equal((await post('{nope')).status, 400);
    const huge = JSON.stringify({ model: M, messages: [msg('x'.repeat(MAX_BODY_BYTES))] });
    assert.equal((await post(huge)).status, 413);
  });

  it('a user over the rate gets 429 rate_limited with retryAfterMs; others are fine', async () => {
    for (let i = 0; i < RATE_PER_MINUTE; i++) assert.equal((await post({ model: M, messages: [msg()] })).status, 200);
    const res = await post({ model: M, messages: [msg()] });
    assert.equal(res.status, 429);
    const data = await res.json();
    assert.equal(data.code, 'rate_limited');
    assert.ok(data.retryAfterMs > 0);
    assert.equal((await post({ model: M, messages: [msg()] }, 'usr_two')).status, 200);
  });

  it('a throttle before the first chunk is a real 429, not a 200 stream', async () => {
    aiProvider.invokeStream = async function* () { yield* []; throw Object.assign(new Error('slow down'), { name: 'ThrottlingException' }); };
    const res = await post({ model: M, stream: true, messages: [msg()] });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).code, 'throttled');
    // The slot was released: the next call goes through.
    aiProvider.invokeStream = async function* () { yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }; };
    const ok = await post({ model: M, stream: true, messages: [msg()] });
    assert.equal(ok.status, 200);
    const text = await ok.text();
    assert.match(text, /"hi"/);
    assert.match(text, /\[DONE\]/);
  });

  it('a failure mid-stream sends a typed SSE error and no [DONE]', async () => {
    aiProvider.invokeStream = async function* () {
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'part' } };
      throw Object.assign(new Error('gone'), { name: 'ServiceUnavailableException' });
    };
    const res = await post({ model: M, stream: true, messages: [msg()] });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /"type":"error".*"code":"overloaded"/);
    assert.doesNotMatch(text, /\[DONE\]/);
  });
});
