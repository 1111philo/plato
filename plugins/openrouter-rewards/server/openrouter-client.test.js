import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterClient } from './openrouter-client.js';

describe('OpenRouter API client', () => {
  it('patches keys with an absolute limit', async () => {
    const calls = [];
    const client = createOpenRouterClient({
      managementKey: 'sk-management',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return Response.json({ data: { hash: 'hash_1', limit: JSON.parse(options.body).limit } });
      },
    });

    await client.patchKey('hash_1', { limit: 15 });

    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/keys/hash_1');
    assert.equal(JSON.parse(calls[0].options.body).limit, 15);
  });

  it('surfaces OpenRouter error bodies', async () => {
    const client = createOpenRouterClient({
      managementKey: 'sk-management',
      fetchImpl: async () => Response.json({ error: 'bad key' }, { status: 400 }),
    });

    await assert.rejects(() => client.getKey('hash_1'), /bad key/);
  });
});
