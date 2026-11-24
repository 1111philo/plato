/**
 * lib/authoringEngine.js, the admin authoring chats (lesson editor,
 * knowledge base editor), against a fake server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ai, reset, signIn, settle } from './helpers/fake-plato.js';

const { clearCache } = await import('../js/storage.js');
const { authoringTurn, authoringExtract, authoringTail, kbProblem, AUTHORING_TAIL } = await import('../src/lib/authoringEngine.js');

const CONVERSATION = 'User: I want to create a new lesson.\n\nAgent: What should learners be able to do?\n\nUser: Write a clear bug report.';
const fresh = () => { reset(); clearCache(); signIn(); ai.length = 0; };

describe('authoring chats', () => {
  it('send only the last 15 messages, role and text only', async () => {
    fresh();
    const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Message ${i}`, msgType: 'x' }));
    const tail = authoringTail(long);
    assert.equal(tail.length, AUTHORING_TAIL);
    assert.deepEqual(Object.keys(tail[0]), ['role', 'content']);
    const { text, readiness, raw } = await authoringTurn({ agent: 'knowledge-base-editor', messages: tail });
    await settle();
    assert.deepEqual(ai[0].messages, tail);
    assert.ok(!('trace' in ai[0]), 'authoring chats are never traced');
    assert.match(raw, /\[READINESS: \d+\]$/);
    assert.doesNotMatch(text, /READINESS/);
    assert.equal(typeof readiness, 'number');
  });

  it('a written text that fails its check is returned with the reason and not saved', async () => {
    fresh();
    let saves = 0;
    const r = await authoringExtract({ what: 'knowledgeBase', conversationText: CONVERSATION, check: () => 'It is too short.', save: async () => { saves++; } });
    assert.equal(r.problem, 'It is too short.');
    assert.equal(saves, 0);
    assert.equal(kbProblem('short'), 'Could not generate a knowledge base from the conversation. Keep adding information.');
  });

  it('saves a text that passes, and a failed save is thrown to the page', async () => {
    fresh();
    let saved = null;
    const r = await authoringExtract({ what: 'lesson', conversationText: CONVERSATION, check: () => null, save: async (md) => { saved = md; } });
    assert.equal(r.problem, null);
    assert.equal(saved, r.markdown);
    await assert.rejects(authoringExtract({ what: 'knowledgeBase', conversationText: CONVERSATION, save: async () => { throw new Error('Server said no'); } }), /Server said no/);
    const preview = await authoringExtract({ what: 'lesson', conversationText: CONVERSATION });
    assert.ok(preview.markdown.length > 0);
  });
});
