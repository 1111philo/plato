/**
 * lib/authoringEngine.js, the admin authoring chats (lesson editor,
 * knowledge base editor), against a fake server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ai, reset, signIn, settle } from './helpers/fake-plato.js';

const { clearCache } = await import('../js/storage.js');
const { authoringTurn, authoringExtract, authoringTail, kbProblem, AUTHORING_TAIL, EXTRACT_ATTEMPTS, withoutInventedDirective, recoverReadiness } = await import('../src/lib/authoringEngine.js');

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
    assert.equal(ai.length, EXTRACT_ATTEMPTS, 'asked again before the problem is shown');
    assert.equal(kbProblem('short'), 'Could not generate a knowledge base from the conversation. Keep adding information.');
  });

  it('a slip the second try doesn’t repeat is saved, with no problem shown (agent evaluations X3)', async () => {
    fresh();
    let checks = 0;
    let saved = null;
    const r = await authoringExtract({ what: 'lesson', conversationText: CONVERSATION, check: () => (checks++ === 0 ? 'Lesson must have a "## Learning Objectives" section.' : null), save: async (md) => { saved = md; } });
    assert.equal(r.problem, null);
    assert.equal(ai.length, 2);
    assert.equal(saved, r.markdown);
  });

  it('a reply without its readiness line gets it asked for once (agent evaluations D2, K4)', async () => {
    const asked = [];
    const turn = { raw: 'What is the start date?', text: 'What is the start date?', readiness: null };
    const fixed = await recoverReadiness(turn, [{ role: 'user', content: 'hi' }], async (addendum, msgs) => { asked.push({ addendum, msgs }); return '[READINESS: 2]'; });
    assert.equal(fixed.readiness, 2);
    assert.equal(fixed.text, turn.text);
    assert.match(asked[0].addendum, /ONLY the line/);
    assert.deepEqual(asked[0].msgs.slice(-2).map((m) => m.role), ['assistant', 'user']);
    assert.equal((await recoverReadiness({ ...turn, readiness: 5 }, [], async () => { throw new Error('not asked'); })).readiness, 5, 'not asked when present');
    assert.equal((await recoverReadiness(turn, [], async () => 'no idea')).readiness, null, 'unreadable: as before');
    assert.equal((await recoverReadiness(turn, [], async () => { throw new Error('busy'); })).readiness, null);
  });

  it('a Coach Directive the author didn’t give is dropped; theirs is kept (agent evaluations X1, X3)', () => {
    const conv = 'User: A lesson on joining our community.\n\nAgent: Any instructions for the coach?\n\nUser: Yes: share https://community.example.org/join and the code PLATO-2026 when they’re ready.';
    const lesson = (directive) => `# Join\n\nJoin us.\n\n## Exemplar\nA screenshot.\n\n## Learning Objectives\n- Can join\n- Can post\n${directive ? `\n## Coach Directive\n${directive}\n` : ''}`;
    const theirs = lesson('Share https://community.example.org/join and the code PLATO-2026 when they’re ready.');
    assert.equal(withoutInventedDirective(theirs, conv), theirs);
    const invented = withoutInventedDirective(lesson('Reference the learner’s actual volunteer experience to personalize examples.'), conv);
    assert.doesNotMatch(invented, /Coach Directive/);
    assert.match(invented, /- Can post\n$/);
    assert.equal(withoutInventedDirective(lesson(''), conv), lesson(''), 'no directive, nothing to do');
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
