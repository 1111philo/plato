import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import ai from '../../src/routes/ai.js';
import aiProvider from '../../src/lib/ai-provider.js';
import { fromConverseResponse, fromConverseStreamEvent } from '../../src/lib/converse.js';
import db from '../../src/lib/db.js';
import { _resetAiLimits } from '../../src/lib/ai-limits.js';
import { signAccessToken } from '../../src/lib/jwt.js';

async function authedReq(app, method, path, body) {
  const token = await signAccessToken('usr_test', 'user');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function unauthReq(app, method, path, body) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /v1/ai/messages', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
    _resetAiLimits();
  });

  it('proxies valid request and returns response', async () => {
    aiProvider.invoke = async (model, body) => {
      assert.equal(model, 'qwen3-vl-235b');
      assert.equal(body.max_tokens, 512);
      assert.equal(body.system, 'You are helpful.');
      assert.equal(body.messages.length, 1);
      return {
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    };
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      max_tokens: 512,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content[0].text, 'Hello!');
  });

  it('a failed non-stream call is logged as ai_invoke_failed and typed for the client', async () => {
    aiProvider.invoke = async () => { throw Object.assign(new Error('Too many requests'), { name: 'ThrottlingException' }); };
    const { logger } = await import('../../src/lib/logger.js');
    const codes = [];
    const orig = logger.error;
    logger.error = (code, meta) => { codes.push([code, meta?.error, meta?.code]); };
    try {
      const app = new Hono();
      app.route('/', ai);
      const res = await authedReq(app, 'POST', '/v1/ai/messages', { model: 'qwen3-vl-235b', messages: [{ role: 'user', content: 'Hi' }] });
      assert.equal(res.status, 429);
      const data = await res.json();
      assert.equal(data.code, 'throttled');
      assert.ok(data.retryAfterMs > 0);
      assert.ok(res.headers.get('retry-after'));
      assert.deepEqual(codes, [['ai_invoke_failed', 'Too many requests', 'throttled']]);
    } finally {
      logger.error = orig;
    }
  });

  it('refuses any model but plato\u2019s own (no free gateway to the account\u2019s models)', async () => {
    let called = false;
    aiProvider.invoke = async () => { called = true; return { content: [{ type: 'text', text: 'ok' }], usage: {} }; };
    const app = new Hono();
    app.route('/', ai);
    for (const model of ['anthropic.claude-custom-v1:0', 'us.anthropic.claude-opus-5-5', 'qwen.qwen3-vl-235b-a22b-other']) {
      const res = await authedReq(app, 'POST', '/v1/ai/messages', { model, messages: [{ role: 'user', content: 'Hi' }] });
      assert.equal(res.status, 400, model);
    }
    assert.equal(called, false);
  });

  it('returns 400 when model is missing', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'model is required');
  });

  it('returns 400 when messages is missing', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'messages array is required');
  });

  it('returns 401 without auth token', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await unauthReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(res.status, 401);
  });

  it('returns 400 when a message has empty string content', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      messages: [{ role: 'user', content: '' }],
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'messages must have non-empty content');
  });

  it('returns 400 when a message has empty array content', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      messages: [{ role: 'user', content: [] }],
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'messages must have non-empty content');
  });

  it('omits system from body when not provided', async () => {
    let receivedBody;
    aiProvider.invoke = async (model, body) => {
      receivedBody = body;
      return { content: [{ type: 'text', text: 'ok' }], usage: {} };
    };
    const app = new Hono();
    app.route('/', ai);
    await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(receivedBody.system, undefined);
  });

  // The route is provider-agnostic: it hands the Anthropic-shaped body to
  // `ai-provider.js`, which routes open-weight models through Converse. These
  // two cases pin the round trip end to end using the real Converse
  // translation, so a translation regression fails here and not only in
  // converse.test.js.
  it('streams Converse-translated events as Anthropic SSE', async () => {
    aiProvider.invokeStream = async function* (model, body) {
      assert.equal(model, 'qwen3-vl-235b');
      assert.equal(body.system, 'You are a coach.');
      for (const event of [
        { messageStart: { role: 'assistant' } },
        { contentBlockDelta: { delta: { text: 'Nice ' }, contentBlockIndex: 0 } },
        { contentBlockDelta: { delta: { text: 'work. [PROGRESS: 10]' }, contentBlockIndex: 0 } },
        { messageStop: { stopReason: 'end_turn' } },
        { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } },
      ]) {
        const translated = fromConverseStreamEvent(event);
        if (translated) yield translated;
      }
    };
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      system: 'You are a coach.',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /text\/event-stream/);

    const raw = await res.text();
    // Reassemble the way client/js/api.js parseSSEStream does.
    const text = raw.split('\n')
      .filter((l) => l.startsWith('data: ') && l.slice(6) !== '[DONE]')
      .map((l) => JSON.parse(l.slice(6)))
      .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');

    assert.equal(text, 'Nice work. [PROGRESS: 10]');
    assert.ok(raw.includes('data: [DONE]'));
  });

  it('returns a Converse-translated non-streaming response in Anthropic shape', async () => {
    aiProvider.invoke = async () => fromConverseResponse({
      output: { message: { role: 'assistant', content: [{ text: 'Done. [PROGRESS: 8]' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 3700, outputTokens: 195 },
    });
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'qwen3-vl-235b',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const data = await res.json();
    assert.equal(data.content[0].type, 'text');
    assert.equal(data.content[0].text, 'Done. [PROGRESS: 8]');
    assert.equal(data.usage.input_tokens, 3700);
  });
});

// A Trace request (docs/ARCHITECTURE.md "Trace mode") also gets what only the
// server knows. Without `trace: true` nothing changes.
describe('POST /v1/ai/messages with trace: true', () => {
  const REQ = { model: 'qwen3-vl-235b', max_tokens: 512, messages: [{ role: 'user', content: 'Hi' }] };
  const app = () => { const a = new Hono(); a.route('/', ai); return a; };
  const sse = async (res) => (await res.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
  let saved;
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_test', role: 'user' });
    _resetAiLimits();
    saved = { describe: aiProvider.describe };
    aiProvider.describe = () => ({ provider: 'bedrock', model: 'qwen.qwen3-vl-235b-a22b', region: 'us-east-2', api: 'converse' });
  });

  it('non-stream: adds provider, applied settings, attempts and timing; the reply itself is unchanged', async () => {
    let opts;
    aiProvider.invoke = async (_m, _b, o) => { opts = o; return { content: [{ type: 'text', text: 'Hello!' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, ...(o?.trace ? { reasoning: 'thinking…', attempts: 2 } : {}) }; };
    const plain = await (await authedReq(app(), 'POST', '/v1/ai/messages', REQ)).json();
    assert.deepEqual(Object.keys(plain).sort(), ['content', 'stop_reason', 'usage']);
    assert.equal(opts, undefined, 'an ordinary request calls the provider exactly as before');

    const traced = await (await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, trace: true, top_p: 0.5, max_tokens: undefined })).json();
    assert.deepEqual(traced.content, plain.content);
    assert.equal(traced.reasoning, 'thinking…');
    assert.equal(traced.attempts, undefined);
    assert.deepEqual(traced.plato.provider, { provider: 'bedrock', model: 'qwen.qwen3-vl-235b-a22b', region: 'us-east-2', api: 'converse' });
    assert.deepEqual(traced.plato.applied, { max_tokens: 1024, maxTokensDefaulted: true, temperature: null, dropped: ['top_p'] });
    assert.equal(traced.plato.attempts, 2);
    assert.equal(typeof traced.plato.ms, 'number');
    aiProvider.describe = saved.describe;
  });

  it('stream: a plato event before and after the model’s events, which are unchanged', async () => {
    const events = [{ type: 'message_start', message: { role: 'assistant', content: [] } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }, { type: 'message_stop', usage: { input_tokens: 1, output_tokens: 1 } }];
    aiProvider.invokeStream = async function* () { yield* events; };
    const plain = await sse(await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, stream: true }));
    assert.deepEqual(plain, [...events.map((e) => JSON.stringify(e)), '[DONE]']);

    const traced = await sse(await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, stream: true, trace: true, temperature: 0 }));
    assert.deepEqual(traced.slice(1, -2), events.map((e) => JSON.stringify(e)));
    const first = JSON.parse(traced[0]);
    assert.equal(first.type, 'plato');
    assert.equal(first.provider.region, 'us-east-2');
    assert.deepEqual(first.applied, { max_tokens: 512, maxTokensDefaulted: false, temperature: 0, dropped: [] });
    assert.equal(typeof JSON.parse(traced.at(-2)).ms, 'number');
    assert.equal(traced.at(-1), '[DONE]');
    aiProvider.describe = saved.describe;
  });

  it('a failure carries the provider’s own error with AWS identifiers removed; an ordinary request gets only the generic one', async () => {
    const boom = () => { throw Object.assign(new Error('User: arn:aws:sts::123456789012:assumed-role/plato-Role/fn is not authorized to perform: bedrock:InvokeModel on account 123456789012'), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403, attempts: 1 } }); };
    aiProvider.invoke = async () => boom();
    const plain = await (await authedReq(app(), 'POST', '/v1/ai/messages', REQ)).json();
    assert.deepEqual(Object.keys(plain).sort(), ['code', 'error']);
    const res = await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, trace: true });
    assert.equal(res.status, 502);
    const { plato } = await res.json();
    assert.equal(plato.error.name, 'AccessDeniedException');
    assert.equal(plato.error.status, 403);
    assert.doesNotMatch(plato.error.message, /123456789012|arn:aws/);
    assert.match(plato.error.message, /\[arn\].*not authorized.*\[account\]/);
    aiProvider.describe = saved.describe;
  });

  it('a mid-stream failure and a rate limit say why', async () => {
    aiProvider.invokeStream = async function* () { yield { type: 'message_start' }; throw Object.assign(new Error('stream broke'), { name: 'ModelStreamErrorException' }); };
    const lines = await sse(await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, stream: true, trace: true }));
    const err = JSON.parse(lines.at(-1));
    assert.equal(err.type, 'error');
    assert.equal(err.plato.error.name, 'ModelStreamErrorException');

    _resetAiLimits();
    aiProvider.invoke = async () => ({ content: [{ type: 'text', text: 'x' }] });
    let last;
    for (let i = 0; i < 31; i++) last = await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, trace: true });
    assert.equal(last.status, 429);
    assert.equal((await last.json()).plato.limit, 'rate');
    aiProvider.describe = saved.describe;
  });

  it('works with a provider that can’t describe itself', async () => {
    aiProvider.describe = undefined;
    aiProvider.invoke = async () => ({ content: [{ type: 'text', text: 'x' }] });
    const data = await (await authedReq(app(), 'POST', '/v1/ai/messages', { ...REQ, trace: true })).json();
    assert.equal(data.plato.provider, null);
    aiProvider.describe = saved.describe;
  });
});

describe('converse: reasoning is passed on only when asked', () => {
  const response = { output: { message: { content: [{ reasoningContent: { reasoningText: { text: 'because…' } } }, { text: 'Answer' }] } }, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 2 } };
  it('response', () => {
    assert.equal(fromConverseResponse(response).reasoning, undefined);
    const traced = fromConverseResponse(response, { reasoning: true });
    assert.equal(traced.reasoning, 'because…');
    assert.deepEqual(traced.content, [{ type: 'text', text: 'Answer' }]);
    assert.equal(fromConverseResponse({ output: { message: { content: [{ text: 'A' }] } } }, { reasoning: true }).reasoning, undefined);
  });
  it('stream delta', () => {
    const event = { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: 'hmm' } } } };
    assert.equal(fromConverseStreamEvent(event), null);
    assert.deepEqual(fromConverseStreamEvent(event, { reasoning: true }), { type: 'content_block_delta', index: 0, delta: { type: 'reasoning_delta', text: 'hmm' } });
    assert.equal(fromConverseStreamEvent({ contentBlockDelta: { delta: { toolUse: {} } } }, { reasoning: true }), null);
  });
});
