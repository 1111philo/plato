/**
 * The Trace view's wording (#595): real recorded lessons, described.
 * Every step must come out as a plain sentence with who decided it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { store, LESSON, reset, signIn, settle } from './helpers/fake-plato.js';

const { clearCache, savePreferences } = await import('../js/storage.js');
const { startLesson, sendMessage } = await import('../src/lib/lessonEngine.js');
const { describeTrace, traceToText, technologyFor } = await import('../src/lib/traceView.js');
const { STEPS, STAGES } = await import('../src/lib/transparency.js');

const ID = LESSON.lessonId;
async function record(messages) {
  reset(); clearCache(); signIn();
  await savePreferences({ name: '', traceMode: true });
  await startLesson(ID, LESSON, () => {});
  for (const text of messages) { try { await sendMessage(ID, LESSON, text, null, [], () => {}); } catch { /* a failed turn is part of the script */ } }
  await settle();
  return describeTrace([...store.keys()].filter((k) => k.startsWith(`trace:${ID}:`)).map((dataKey) => ({ dataKey, data: store.get(dataKey) })));
}

describe('describeTrace', () => {
  it('every step of a full lesson reads as a sentence, with who decided and the exact text behind it', async () => {
    const view = await record(['My first answer.', 'MOCK_NOTAGS A second thought.', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_COMPLETE I applied it to my garden plan.']);
    const seen = new Set();
    for (const turn of view.exchanges) {
      assert.ok(turn.title && turn.verdict.text && turn.verdict.sourceLabel && turn.verdict.short);
      // Grouped in the stages a person reads, in their fixed order.
      const order = turn.stages.map((st) => Object.keys(STAGES).indexOf(st.id));
      assert.deepEqual(order, [...order].sort((a, b) => a - b));
      for (const st of turn.stages) assert.ok(st.title && (st.steps.length || st.followups));
      for (const s of turn.steps) {
        seen.add(s.type);
        assert.ok(s.title, `${s.type} has no title`);
        assert.ok(s.summary && !/undefined|\[object Object\]|NaN/.test(s.summary), `${s.type}: "${s.summary}"`);
        assert.ok(['model', 'instructions', 'code', 'person'].includes(s.source));
        for (const d of s.details) assert.ok(d.label && typeof d.text === 'string' && !/\[object Object\]/.test(d.text), `${s.type} detail ${d.label}`);
      }
    }
    // The script reaches most of what a lesson can do.
    for (const t of ['lesson', 'planned', 'validation', 'plugins', 'input', 'state', 'tail', 'context', 'history', 'call', 'parsed', 'tagRepair', 'gradingPlan', 'verdict', 'verdictApplied', 'heldRewrite', 'claimCheck', 'applied', 'save', 'event', 'followUp', 'profileSaved']) {
      assert.ok(seen.has(t), `the script never recorded "${t}"`);
    }
    assert.ok([...seen].every((t) => STEPS[t]));
  });

  it('one exchange per turn, titled from what the learner wrote, with the background agents it set off inside it', async () => {
    const view = await record(['My first answer.']);
    assert.deepEqual(view.exchanges.map((t) => [t.n, t.kind]), [[1, 'start'], [2, 'turn']]);
    assert.equal(view.exchanges[0].title, 'Lesson start');
    assert.equal(view.exchanges[1].title, 'Your message: “My first answer.”');
    assert.equal(view.exchanges[1].you, 'My first answer.');
    assert.match(view.exchanges[1].saw, /Good thinking/);
    assert.match(view.exchanges[1].headline, /^Progress \d+ → \d+ of 10$/);
    const background = view.exchanges[1].stages.find((st) => st.id === 'background');
    assert.match(background.followups[0].title, /^Learner profile/);
    assert.ok(background.followups[0].steps.some((s) => s.type === 'profileSaved'));
  });

  it('shows the lesson only where it matters: at the start, or when it was edited mid-lesson', async () => {
    const view = await record(['My first answer.', 'And another.']);
    assert.ok(view.exchanges[0].steps.some((s) => s.type === 'lesson'));
    assert.ok(view.exchanges.slice(1).every((e) => !e.steps.some((s) => s.type === 'lesson')));
    // Edited after the learner started: shown, and flagged.
    const items = [...store.keys()].filter((k) => k.startsWith(`trace:${ID}:`)).map((dataKey) => ({ dataKey, data: structuredClone(store.get(dataKey)) }));
    const last = items.filter((i) => i.data.kind === 'turn').at(-1);
    last.data.steps.find((s) => s.type === 'lesson').updatedAt = '2099-01-01T00:00:00Z';
    items.find((i) => i.data.kind === 'start').data.steps.find((s) => s.type === 'lesson').updatedAt = '2026-01-01T00:00:00Z';
    const edited = describeTrace(items).exchanges.at(-1);
    assert.ok(edited.flags.some((f) => f.id === 'edited'));
    assert.equal(edited.steps.find((s) => s.type === 'lesson').stage, 'prepared');
  });

  it('says who shaped each result: the model, plato’s instructions, or plato’s code', async () => {
    const view = await record(['My first answer.', 'MOCK_NOTAGS A second thought.', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_COMPLETE I applied it to my garden plan.']);
    const turns = view.exchanges.filter((t) => t.kind === 'turn');
    assert.equal(turns[0].verdict.source, 'model');
    assert.match(turns[0].verdict.text, /plato’s code changed nothing/);
    assert.equal(turns[1].verdict.source, 'instructions');
    assert.equal(turns[2].verdict.source, 'code');
    assert.match(turns[2].verdict.text, /Completion was held/);
    assert.equal(turns[3].verdict.source, 'model');
  });

  it('gathers what was unusual', async () => {
    const view = await record(['MOCK_NOTAGS first', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_TRUNCATE more']);
    const ids = view.exchanges.flatMap((e) => e.flags.map((f) => f.id));
    for (const id of ['tags', 'held', 'failed', 'cutOff']) assert.ok(ids.includes(id), `no "${id}" flag in ${ids}`);
    assert.equal(view.flagged, view.exchanges.filter((e) => e.flags.length).length);
    const held = view.exchanges.find((t) => t.flags.some((f) => f.id === 'held'));
    assert.ok(held.firstSeen && held.saw && held.firstSeen !== held.saw, 'the reply watched first and the one kept are both there');
    const applied = held.steps.find((s) => s.type === 'applied');
    assert.ok(applied.rules.some((r) => r.id === 'heldAt8' && /held/.test(r.text)));
  });

  it('shows exactly what the model was given and what it said', async () => {
    const view = await record(['My first answer.']);
    const call = view.exchanges[1].steps.find((s) => s.type === 'call');
    assert.match(call.title, /^Coach: reply$/);
    assert.match(call.summary, /stand-in model used for testing/);
    const labels = call.details.map((d) => d.label);
    assert.ok(labels.some((l) => /^Instructions: The agent’s instructions \(plato’s instructions\)$/.test(l)));
    assert.ok(labels.some((l) => /^Instructions: Program knowledge base \(A person\)$/.test(l)));
    assert.match(call.details.find((d) => /^Messages sent/.test(d.label)).text, /My first answer\./);
    assert.match(call.details.find((d) => d.label === 'The model’s raw reply').text, /\[PROGRESS: \d+\]/);
    assert.match(call.details.find((d) => d.label === 'The model’s own reasoning').text, /None was returned/);
    const context = view.exchanges[1].steps.find((s) => s.type === 'context');
    assert.ok(context.details.some((d) => d.label === 'Your first name (A person)' && d.text === 'Ada'));
  });

  it('profile notes and authoring chats: titles, verdicts and sentences that fit them', async () => {
    const { addLearnerNote, removeLearnerNote } = await import('../src/lib/profileQueue.js');
    const { authoringTurn, authoringExtract } = await import('../src/lib/authoringEngine.js');
    const { resetTraceSession } = await import('../src/lib/traceSession.js');
    reset(); clearCache(); resetTraceSession(); signIn();
    await savePreferences({ name: '', traceMode: true });
    await addLearnerNote('I use a Chromebook.');
    await (await removeLearnerNote(0)).done;
    await authoringTurn({ scope: 'kb', agent: 'knowledge-base-editor', messages: [{ role: 'user', content: 'I want to create a knowledge base for my program.' }] });
    await authoringTurn({ scope: 'kb', agent: 'knowledge-base-editor', text: 'We teach adults.', messages: [{ role: 'user', content: 'We teach adults.' }], readinessBefore: 1 });
    await authoringExtract({ scope: 'kb', what: 'knowledgeBase', conversationText: 'User: We teach adults.', save: async () => {} });
    await settle();
    const of = (scope) => describeTrace([...store.keys()].filter((k) => k.startsWith(`trace:${scope}:`)).map((dataKey) => ({ dataKey, data: store.get(dataKey) })));

    const profile = of('profile');
    assert.deepEqual(profile.exchanges.map((t) => t.title), ['You added a note: “I use a Chromebook.”', 'You removed a note: “I use a Chromebook.”']);
    assert.match(profile.exchanges[0].steps[0].summary, /^You added a note: “I use a Chromebook\.”\. It was kept with your profile, word for word\.$/);
    assert.equal(profile.exchanges[0].steps[0].source, 'person');
    assert.equal(profile.exchanges[0].verdict.source, 'model');
    assert.match(profile.exchanges[0].verdict.text, /kept your own notes/);

    const kb = of('kb');
    assert.deepEqual(kb.exchanges.map((t) => t.title), ['Conversation start', 'Your message: “We teach adults.”', 'Save: writing the knowledge base']);
    const parsed = kb.exchanges[1].steps.find((s) => s.type === 'authoringParsed');
    assert.match(parsed.summary, /^Readiness score: 2 of 10 \(it was 1\)\./);
    assert.equal(parsed.source, 'code');
    assert.match(kb.exchanges[1].verdict.text, /readiness score are the model’s own/);
    assert.match(kb.exchanges[2].verdict.text, /checked it and saved it/);
    for (const turn of [...profile.exchanges, ...kb.exchanges]) {
      for (const s of turn.steps) assert.ok(s.summary && !/undefined|\[object Object\]|NaN/.test(s.title + s.summary), `${s.type}: "${s.summary}"`);
    }
  });

  it('tolerates an empty or unknown trace', () => {
    assert.deepEqual(describeTrace([]), { exchanges: [], orphans: [], flagged: 0, partial: false });
    assert.deepEqual(describeTrace(null).exchanges, []);
    const odd = describeTrace([{ dataKey: 'trace:x:t:1', data: { at: 1, kind: 'turn', steps: [{ n: 1, type: 'somethingNew', ms: 0 }] } }]);
    assert.equal(odd.exchanges[0].steps[0].title, 'somethingNew');
  });

  it('downloads as plain text: every turn, who decided, rules, before and after, exact text', async () => {
    const view = await record(['My first answer.', 'MOCK_COMPLETE MOCK_UNBACKED done?']);
    const text = traceToText(view, { title: 'plato trace: Trace lesson' });
    assert.match(text, /^plato trace: Trace lesson\n=+/);
    assert.match(text, /Unusual: /);
    assert.match(text, /You sent:\n/);
    assert.match(text, /\d\) plato checked the answer/);
    assert.match(text, /1\. Lesson start · \d{4}-/);
    assert.match(text, /\[plato’s code\]/);
    assert.match(text, /Rule: .*held/i);
    assert.match(text, /Before:\n {6}/);
    assert.match(text, /The model’s raw reply:\n {6}/);
    assert.doesNotMatch(text, /undefined|\[object Object\]/);
  });

  it('plugin steps recorded at lesson start are shown', () => {
    const view = describeTrace([{ dataKey: 'trace:x:t:1', data: { at: 1, kind: 'start', steps: [{ n: 1, type: 'plugins', ms: 0, status: 200, enrichments: [], pluginTraces: { 'wordpress-info': [
      { type: 'ai', purpose: 'plan the searches', model: 'm', system: 'You plan.', messages: [{ role: 'user', content: 'lesson' }], reply: '{"q":[]}', usage: { input_tokens: 3, output_tokens: 4 } },
      { type: 'fetch', purpose: 'search the handbook', url: 'https://developer.wordpress.org/?s=x', status: 200 },
      { type: 'note', text: 'Nothing relevant was found.' },
    ] } }] } }]);
    const detail = view.exchanges[0].steps[0].details.find((d) => /wordpress-info: every step/.test(d.label));
    assert.match(detail.text, /1\. Asked the AI model \(m\): plan the searches/);
    assert.match(detail.text, /2\. Requested https:\/\/developer\.wordpress\.org\/\?s=x: search the handbook \(answered 200\)/);
    assert.match(detail.text, /3\. Nothing relevant was found\./);
  });
});

describe('technologyFor', () => {
  const call = (provider) => [{ dataKey: 'trace:x:t:1', data: { steps: [{ type: 'call', server: { provider } }] } }];
  it('lists every service, says which this classroom uses, and names the model and region a call reported', () => {
    const tech = technologyFor(call({ provider: 'bedrock', model: 'qwen.qwen3-vl-235b-a22b', region: 'us-east-2' }), { plugins: ['slack'] });
    const by = Object.fromEntries(tech.map((t) => [t.id, t]));
    assert.equal(by.bedrock.inUse, true);
    assert.equal(by.bedrock.detail, 'Region: us-east-2.');
    assert.match(by.model.detail, /qwen\.qwen3-vl-235b-a22b/);
    assert.equal(by.slack.inUse, true);
    assert.equal(by.sso.inUse, false);
    assert.equal(by.wordpress.inUse, false);
    assert.ok(tech.every((t) => t.name && t.role && t.sent));
  });
  it('says so when the model is a stand-in, and copes with no trace', () => {
    assert.match(technologyFor(call({ provider: 'mock', model: 'mock' }))[1].detail, /stand-in model/);
    assert.ok(technologyFor([]).length >= 10);
    assert.equal(technologyFor(null).find((t) => t.id === 'model').detail, null);
  });
});
