import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deliverOpenRouterKey } from './openrouter-delivery.js';

describe('Slack OpenRouter key delivery', () => {
  it('no-ops when slackDmAllowed is false', async () => {
    const calls = [];
    const result = await deliverOpenRouterKey({
      payload: { slackDmAllowed: false, plaintext: 'sk-or-secret' },
      settings: { botToken: 'xoxb-token' },
      slack: { sendDm: async () => calls.push('sent') },
    });

    assert.deepEqual(result, { delivered: false, reason: 'not_allowed' });
    assert.deepEqual(calls, []);
  });

  it('sends plaintext only when explicitly allowed and a Slack user resolves', async () => {
    const calls = [];
    const result = await deliverOpenRouterKey({
      payload: { slackDmAllowed: true, plaintext: 'sk-or-secret', userEmail: 'a@example.com' },
      settings: { botToken: 'xoxb-token' },
      slack: {
        findUserByEmail: async () => ({ id: 'U123' }),
        sendDm: async (userId, text) => calls.push({ userId, text }),
      },
    });

    assert.equal(result.delivered, true);
    assert.equal(calls[0].userId, 'U123');
    assert.match(calls[0].text, /sk-or-secret/);
  });
});
