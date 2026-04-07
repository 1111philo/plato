import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import ai from '../../src/routes/ai.js';
import aiProvider from '../../src/lib/ai-provider.js';
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
      assert.equal(model, 'claude-haiku-4-5-20251001');
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
      model: 'claude-haiku-4-5-20251001',
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
      model: 'claude-haiku-4-5-20251001',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'messages array is required');
  });

  it('returns 401 without auth token', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await unauthReq(app, 'POST', '/v1/ai/messages', {
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(res.status, 401);
  });

  it('returns 400 when a message has empty string content', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: '' }],
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'messages must have non-empty content');
  });

  it('returns 400 when a message has empty array content', async () => {
    const app = new Hono();
    app.route('/', ai);
    const res = await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'claude-haiku-4-5-20251001',
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
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(receivedBody.system, undefined);
  });
});
