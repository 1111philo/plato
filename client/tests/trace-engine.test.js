/**
 * Trace mode end to end (#595): real lessons run through the lesson engine
 * against a fake server, with Trace off and on.
 *
 * - Off is a no-op: no request asks for a trace, nothing is recorded.
 * - Recording changes nothing: the same requests, in the same order, with
 *   Trace on or off.
 * - Replay: every AI request can be rebuilt from the stored trace alone and
 *   equals what was sent. If the trace can't reproduce it, the trace is
 *   missing something.
 * - Every way a turn can go (held completion, missing tags, a cut-off reply,
 *   a busy model) leaves a trace that says so.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { store, ai, events, lessonStarts, PLUGIN_TRACES, LESSON, reset, signIn, traces, settle } from './helpers/fake-plato.js';

const { clearCache, savePreferences, deleteLessonProgress, getLessonKB, saveLessonKB } = await import('../js/storage.js');
const { startLesson, sendMessage } = await import('../src/lib/lessonEngine.js');
const { rebuildRequest, storableBody, MAX_SCOPE_BYTES } = await import('../src/lib/lessonTrace.js');
const { STEPS, RULES, AGENTS } = await import('../src/lib/transparency.js');

const ID = LESSON.lessonId;
const noop = () => {};

async function lesson(messages, { trace = false } = {}) {
  reset();
  clearCache();
  signIn();
  if (trace) await savePreferences({ name: '', traceScopes: [ID] });
  ai.length = 0;
  await startLesson(ID, LESSON, noop);
  const results = [];
  for (const text of messages) {
    try { results.push(await sendMessage(ID, LESSON, text, null, [], noop)); } catch (e) { results.push({ error: e }); }
  }
  await settle();
  return { results, requests: ai.map((b) => structuredClone(b)), events: [...events] };
}

const callsOf = (records) => records.flatMap((r) => r.steps.filter((s) => s.type === 'call').map((call) => ({ call, record: r })));

describe('Trace off', () => {
  it('asks for nothing and records nothing', async () => {
    const { requests } = await lesson(['My first answer.', 'MOCK_COMPLETE I applied it to my garden plan.']);
    assert.ok(requests.length >= 4);
    assert.ok(requests.every((b) => !('trace' in b)));
    assert.deepEqual([...store.keys()].filter((k) => k.startsWith('trace:')), []);
    assert.equal((await getLessonKB(ID)).trace, undefined, 'no stamp on the lesson');
  });

  it('doesn’t ask plugins for their steps', async () => {
    await lesson([]);
    assert.equal(lessonStarts.length, 1);
    assert.deepEqual(Object.keys(lessonStarts[0]), ['lessonId', 'lesson', 'lessonKB'], 'the lesson-started body is what it always was');
  });
});

describe('Trace on', () => {
  const SCRIPT = ['My first answer.', 'MOCK_NOTAGS A second thought.', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_COMPLETE I applied it to my garden plan.'];

  it('sends the same requests in the same order as with Trace off (plus `trace: true`)', async () => {
    const off = await lesson(SCRIPT);
    const on = await lesson(SCRIPT, { trace: true });
    assert.equal(on.requests.length, off.requests.length);
    assert.ok(on.requests.every((b) => b.trace === true));
    // The two runs happen at different moments; clock readings inside the
    // agents' input (profile dates, lesson start) are the only difference.
    const plain = (b) => JSON.stringify({ ...b, trace: undefined }).replace(/\b1[6-9]\d{11}\b/g, '0');
    assert.deepEqual(on.requests.map(plain), off.requests.map(plain));
    assert.deepEqual(on.events, off.events);
    assert.deepEqual(on.results.map((r) => [r.progress, r.achieved]), off.results.map((r) => [r.progress, r.achieved]));
  });

  it('replay: every request is rebuilt exactly from the trace', async () => {
    const { requests } = await lesson(SCRIPT, { trace: true });
    const all = traces(ID);
    const recorded = callsOf([...all.t, ...all.b].sort((a, b) => a.at - b.at));
    assert.equal(recorded.length, requests.length, 'one recorded call per request');
    const sent = requests.map((b) => JSON.stringify(storableBody(b)));
    for (const { call, record } of recorded) {
      const history = record.steps.find((s) => s.type === 'history');
      const rebuilt = rebuildRequest(call, { history, parts: all.p });
      assert.notEqual(rebuilt.system, null, `every prompt part of ${call.agent} is stored`);
      const at = sent.indexOf(JSON.stringify(storableBody(sortLike(rebuilt))));
      assert.notEqual(at, -1, `${call.agent} (${call.purpose}) was not sent as recorded`);
      sent.splice(at, 1);
    }
    assert.equal(sent.length, 0);
  });

  it('stamps the lesson, stores each prompt part once, and keeps traces out of the bulk load', async () => {
    await lesson(SCRIPT, { trace: true });
    const kb = await getLessonKB(ID);
    assert.equal(kb.trace.partial, undefined);
    const all = traces(ID);
    assert.equal(all.t.length, 1 + SCRIPT.length, 'the start and each turn');
    assert.equal(all.t[0].kind, 'start');
    // 17 calls share 8 distinct long parts (each agent's instructions, the
    // knowledge base, one held-completion addition). The Claim Check's
    // instructions are short enough to be stored inline.
    assert.equal(Object.keys(all.p).length, 8, 'parts are stored once, not per call');
    const bulk = await (await fetch('/v1/sync')).json();
    assert.ok(bulk.every((i) => !i.dataKey.startsWith('trace:')));
    assert.ok(all.t.every((r) => r.app.build && !('by' in r.app)));
  });

  it('plugins: what each one did at the start is in the trace, and nowhere else', async () => {
    await lesson([], { trace: true });
    assert.equal(lessonStarts.length, 1);
    assert.equal(lessonStarts[0].trace, true);
    const { trace: _asked, ...rest } = lessonStarts[0];
    assert.deepEqual(Object.keys(rest), ['lessonId', 'lesson', 'lessonKB'], 'only `trace: true` is added');

    const step = traces(ID).t[0].steps.find((s) => s.type === 'plugins');
    assert.equal(step.status, 200);
    assert.deepEqual(step.pluginTraces, PLUGIN_TRACES);
    assert.deepEqual(step.pluginTraces['wordpress-info'].map((s) => s.type), ['ai', 'fetch', 'note']);

    // Never on the lesson's record, so never in what the coach is given.
    const kb = await getLessonKB(ID);
    assert.doesNotMatch(JSON.stringify(kb), /pluginTraces|Is this lesson about WordPress/);
    assert.equal(kb.enrichments, undefined);
    assert.ok(ai.every((b) => !JSON.stringify(b).includes('Is this lesson about WordPress')), 'no AI request carries a plugin’s steps');
  });

  it('records each kind of turn so a person can see what happened', async () => {
    await lesson(SCRIPT, { trace: true });
    const [, plain, noTags, held, done] = traces(ID).t;
    const types = (r) => r.steps.map((s) => s.type);
    const step = (r, t) => r.steps.find((s) => s.type === t);

    assert.deepEqual(types(plain).slice(0, 6), ['lesson', 'input', 'state', 'tail', 'context', 'history']);
    assert.equal(step(plain, 'input').text, 'My first answer.');
    assert.equal(step(plain, 'context').context.learnerName, 'Ada');
    assert.match(step(plain, 'parsed').raw, /\[PROGRESS: \d+\]/);
    assert.equal(step(plain, 'call').server.provider.provider, 'mock');
    assert.deepEqual(step(plain, 'call').usage, { input_tokens: 0, output_tokens: 0 });
    assert.equal(step(plain, 'call').stopReason, 'end_turn');
    assert.equal(step(plain, 'shown').replaced, false);

    assert.equal(step(noTags, 'tagRepair').recovered, true);
    assert.ok(noTags.steps.some((s) => s.type === 'call' && s.purpose === 'tag repair'));
    assert.ok(noTags.steps.some((s) => s.type === 'event' && s.code === 'coach_tags_recovered'));

    assert.equal(step(held, 'gradingPlan').completionClaimed, true);
    assert.equal(step(held, 'verdictApplied').held, true);
    assert.ok(step(held, 'applied').rules.includes('heldAt8'));
    assert.ok(held.steps.some((s) => s.type === 'call' && s.agent === 'assessor'));
    assert.equal(step(held, 'shown').replaced, true, 'the learner watched a reply that was then replaced');
    assert.ok(step(held, 'applied').progress.after <= 8);

    assert.ok(step(done, 'applied').rules.includes('completed'));
    assert.equal(step(done, 'applied').status.after, 'completed');
    const evidence = step(done, 'verdict').evidence;
    assert.ok(Object.values(evidence).flat().every((q) => q.ok && q.learnerAt >= 0), 'each quote is tied to the learner message it came from');
    assert.ok(done.steps.filter((s) => s.type === 'followUp').length >= 1);
    assert.ok(traces(ID).b.length >= 1, 'follow-up agents leave their own records');
  });

  it('every recorded step, rule and agent is described in plain words', async () => {
    await lesson(SCRIPT, { trace: true });
    const all = traces(ID);
    for (const s of [...all.t, ...all.b].flatMap((r) => r.steps)) {
      assert.ok(STEPS[s.type], `step "${s.type}" has no description in transparency.js`);
      if (s.type === 'call') assert.ok(AGENTS[s.agent], `agent "${s.agent}" has no description`);
      if (s.type === 'applied') for (const rule of s.rules) assert.ok(RULES[rule], `rule "${rule}" has no description`);
    }
  });

  it('a failed turn still leaves its trace, with the reason', async () => {
    const { results } = await lesson(['MOCK_TRUNCATE tell me more', 'MOCK_THROTTLE again'], { trace: true });
    assert.ok(results[0].error && results[1].error);
    const [, cutOff, busy] = traces(ID).t;
    assert.equal(cutOff.failed, true);
    assert.equal(cutOff.steps.at(-1).type, 'error');
    assert.equal(cutOff.steps.at(-1).error.type, 'truncated');
    assert.equal(cutOff.steps.find((s) => s.type === 'call').stopReason, 'max_tokens');
    assert.equal(busy.failed, true);
    const call = busy.steps.find((s) => s.type === 'call');
    assert.equal(call.error.type, 'rate_limit');
    assert.equal(call.attempts.length, 1, 'the one retry is on record');
    assert.equal(call.error.server.error.name, 'ThrottlingException', 'with the provider’s own error');
  });

  it('turned on mid-lesson: recorded from the next message and marked partial', async () => {
    reset(); clearCache(); signIn();
    await startLesson(ID, LESSON, noop);
    await sendMessage(ID, LESSON, 'Before trace.', null, [], noop);
    assert.equal(traces(ID).t.length, 0);
    await savePreferences({ name: '', traceScopes: [ID] });
    await sendMessage(ID, LESSON, 'After trace.', null, [], noop);
    await settle();
    const all = traces(ID);
    assert.equal(all.t.length, 1);
    assert.equal(all.t[0].partial, true);
    assert.equal((await getLessonKB(ID)).trace.partial, true);
    // Turned off again: recording stops, what was recorded stays.
    await savePreferences({ name: '', traceScopes: [] });
    await sendMessage(ID, LESSON, 'Off again.', null, [], noop);
    await settle();
    assert.equal(traces(ID).t.length, 1);
  });

  it('is on for the lesson it was turned on for, and no other', async () => {
    reset(); clearCache(); signIn();
    const OTHER = { ...LESSON, lessonId: 'other-lesson', name: 'Other lesson' };
    await savePreferences({ name: '', traceScopes: [ID] });
    await startLesson(OTHER.lessonId, OTHER, noop);
    await sendMessage(OTHER.lessonId, OTHER, 'Not traced.', null, [], noop);
    await settle();
    assert.equal([...store.keys()].filter((k) => k.startsWith('trace:other-lesson:')).length, 0);
    assert.equal((await getLessonKB(OTHER.lessonId)).trace, undefined);
  });

  it('stops recording at the size limit, and the lesson’s stamp says so', async () => {
    await lesson(['My first answer.'], { trace: true });
    // The size is known once a turn's trace is written, so the next turn stamps it.
    await sendMessage(ID, LESSON, 'A second answer.', null, [], noop);
    await settle();
    const kb = await getLessonKB(ID);
    assert.ok(kb.trace.bytes > 10_000, 'the stamp carries the size so far');
    // As if earlier sessions had filled it.
    await saveLessonKB(ID, { ...kb, trace: { ...kb.trace, bytes: MAX_SCOPE_BYTES } });
    const before = traces(ID).t.length;
    ai.length = 0;
    await sendMessage(ID, LESSON, 'One more.', null, [], noop);
    await settle();
    assert.equal(traces(ID).t.length, before, 'nothing more is recorded');
    assert.ok(ai.every((b) => !('trace' in b)));
    assert.equal((await getLessonKB(ID)).trace.full, true);
  });

  it('the stamp never reaches an agent', async () => {
    const { requests } = await lesson(SCRIPT, { trace: true });
    for (const b of requests) assert.doesNotMatch(JSON.stringify(b.messages), /"trace":\{"since"/);
  });

  it('resetting the lesson deletes its trace, one key at a time', async () => {
    await lesson(['My first answer.'], { trace: true });
    assert.ok([...store.keys()].some((k) => k.startsWith(`trace:${ID}:`)));
    await deleteLessonProgress(ID);
    assert.deepEqual([...store.keys()].filter((k) => k.startsWith('trace:')), []);
  });
});

// rebuildRequest's key order differs from the request's; JSON comparison needs the same order.
function sortLike(b) {
  const { model, max_tokens, system, messages, stream, temperature, trace } = b;
  return { model, max_tokens, system, messages, ...(stream ? { stream } : {}), ...(temperature != null ? { temperature } : {}), ...(trace ? { trace } : {}) };
}
