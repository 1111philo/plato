import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import ai from '../../src/routes/ai.js';
import db from '../../src/lib/db.js';
import bedrock from '../../src/lib/bedrock.js';
import { signAccessToken } from '../../src/lib/jwt.js';

async function authedReq(app, method, path, body) {
  const token = await signAccessToken('usr_test', 'participant');
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
    db.getUserById = async () => ({ userId: 'usr_test', role: 'participant' });
  });

  it('proxies valid request to Bedrock and returns response', async () => {
    bedrock.invoke = async (modelId, body) => {
      assert.match(modelId, /claude-haiku/);
      assert.equal(body.anthropic_version, 'bedrock-2023-05-31');
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

  it('passes unmapped model IDs through as-is', async () => {
    let receivedModelId;
    bedrock.invoke = async (modelId) => {
      receivedModelId = modelId;
      return { content: [{ type: 'text', text: 'ok' }], usage: {} };
    };
    const app = new Hono();
    app.route('/', ai);
    await authedReq(app, 'POST', '/v1/ai/messages', {
      model: 'anthropic.claude-custom-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(receivedModelId, 'anthropic.claude-custom-v1:0');
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

  it('omits system from Bedrock body when not provided', async () => {
    let receivedBody;
    bedrock.invoke = async (modelId, body) => {
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
