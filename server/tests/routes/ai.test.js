import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import ai from '../../src/routes/ai.js';
import aiProvider from '../../src/lib/ai-provider.js';
import { fromConverseResponse, fromConverseStreamEvent } from '../../src/lib/converse.js';
import db from '../../src/lib/db.js';
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

  it('passes model ID through to provider', async () => {
    let receivedModel;
    aiProvider.invoke = async (model) => {
      receivedModel = model;
      return { content: [{ type: 'text', text: 'ok' }], usage: {} };
    };
    const app = new Hono();
    app.route('/', ai);
    await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'anthropic.claude-custom-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(receivedModel, 'anthropic.claude-custom-v1:0');
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
