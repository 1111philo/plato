import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrace, hashText, storableMessages, storableBody, rebuildRequest, rulesApplied, isTraceOn, traceTurnedOnBy, traceKey,
  LINK_EXCERPT_CHARS, MAX_PART_CHARS,
} from '../src/lib/lessonTrace.js';

function recorder(extra = {}) {
  const saved = [];
  let t = 1763900000000;
  const trace = createTrace({ scope: 'wp-1', kind: 'turn', save: async (key, data) => { saved.push([key, structuredClone(data)]); return { ok: true }; }, now: () => (t += 5), ...extra });
  return { trace, saved };
}

describe('switches', () => {
  it('either the person’s own switch or the admin’s turns it on', () => {
    assert.equal(isTraceOn({}), false);
    assert.equal(isTraceOn({ preferences: { traceMode: false }, user: {} }), false);
    assert.equal(isTraceOn({ preferences: { traceMode: true } }), true);
    assert.equal(isTraceOn({ user: { traceMode: true } }), true);
    assert.equal(traceTurnedOnBy({ user: { traceMode: true } }), 'team');
    assert.equal(traceTurnedOnBy({ user: {} }), 'self');
    assert.equal(traceKey('wp-1', 't', '123'), 'trace:wp-1:t:123');
  });
});

describe('hashText', () => {
  it('is stable, 16 hex characters, and tells different texts apart', () => {
    assert.match(hashText('abc'), /^[0-9a-f]{16}$/);
    assert.equal(hashText('abc'), hashText('abc'));
    assert.notEqual(hashText('abc'), hashText('abd'));
    assert.notEqual(hashText('ab'), hashText('ba'));
    assert.match(hashText(''), /^[0-9a-f]{16}$/);
  });
});

describe('storableMessages', () => {
  it('keeps text exactly; an image becomes its type and size; an attached page keeps its start and length', () => {
    const page = `[REFERENCE CONTEXT — Learner attached a web page for your review]\n${'x'.repeat(5000)}`;
    const out = storableMessages([
      { role: 'user', content: 'plain' },
      { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'text', text: page }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] },
    ]);
    assert.equal(out[0].content, 'plain');
    assert.deepEqual(out[1].content[0], { type: 'text', text: 'hi' });
    assert.equal(out[1].content[1].excerpt.length, LINK_EXCERPT_CHARS);
    assert.equal(out[1].content[1].chars, page.length);
    assert.deepEqual(out[1].content[2], { type: 'image', mediaType: 'image/png', base64Chars: 4 });
    assert.doesNotMatch(JSON.stringify(out), /AAAA/);
    assert.deepEqual(storableBody({ model: 'm', messages: [{ role: 'user', content: 'plain' }] }), { model: 'm', messages: [{ role: 'user', content: 'plain' }] });
  });
});

describe('createTrace', () => {
  it('records steps in order, stores long prompt parts once, and writes one record', async () => {
    const known = new Set();
    const { trace, saved } = recorder({ knownParts: known, app: { build: 'b1' } });
    const long = 'L'.repeat(1000);
    const base = [{ role: 'user', content: 'ctx' }, { role: 'assistant', content: 'Ready.' }];
    trace.step('input', { text: 'hi' });
    trace.setBase(base);
    const parts = [{ kind: 'prompt', text: long }, { kind: 'addendum', text: 'short' }];
    const a = trace.begin({ agent: 'coach', purpose: 'reply', model: 'm', maxTokens: 10, stream: true, parts, messages: base });
    a.meta({ usage: { input_tokens: 1, output_tokens: 2 } });
    a.meta({ reasoning: 'be' }); a.meta({ reasoning: 'cause' });
    a.end('Hello', { stopReason: 'end_turn' });
    const b = trace.begin({ agent: 'coach', purpose: 'tag repair', model: 'm', maxTokens: 5, parts, messages: [...base, { role: 'user', content: 'tags?' }] });
    b.attempt({ type: 'rate_limit', message: 'busy', status: 429 });
    b.fail({ type: 'timeout', message: 'slow' });

    const first = await trace.flush();
    assert.equal(first.key, 'trace:wp-1:t:1763900000005');
    assert.equal(first.ok, true);
    assert.ok(first.bytes > 1000, 'reports how much it wrote, for the size limit');
    assert.equal(await trace.flush(), null, 'never written twice');

    assert.equal(saved.length, 2, 'one part record, one turn record');
    assert.equal(saved[0][0], `trace:wp-1:p:${hashText(long)}`);
    assert.ok(known.has(hashText(long)));
    const record = saved[1][1];
    assert.deepEqual(record.steps.map((s) => s.type), ['input', 'history', 'call', 'call']);
    assert.deepEqual(record.steps.map((s) => s.n), [1, 2, 3, 4]);
    const [, history, call1, call2] = record.steps;
    assert.deepEqual(call1.system, [{ kind: 'prompt', chars: 1000, hash: hashText(long) }, { kind: 'addendum', chars: 5, text: 'short' }]);
    assert.deepEqual(call1.messages, { base: 2, extra: [] });
    assert.deepEqual(call2.messages, { base: 2, extra: [{ role: 'user', content: 'tags?' }] });
    assert.equal(call1.reply, 'Hello');
    assert.equal(call1.reasoning, 'because');
    assert.equal(call1.stopReason, 'end_turn');
    assert.equal(call2.attempts[0].status, 429);
    assert.equal(call2.error.type, 'timeout');
    assert.equal(record.app.build, 'b1');

    const rebuilt = rebuildRequest(call2, { history, parts: { [hashText(long)]: long } });
    assert.equal(rebuilt.system, long + 'short');
    assert.deepEqual(rebuilt.messages, [...base, { role: 'user', content: 'tags?' }]);
    assert.equal(rebuildRequest(call2, { history, parts: {} }).system, null, 'a missing part is reported, not guessed');
  });

  it('a part already stored for this conversation is not written again', async () => {
    const long = 'L'.repeat(1000);
    const { trace, saved } = recorder({ knownParts: new Set([hashText(long)]) });
    trace.begin({ agent: 'coach', model: 'm', maxTokens: 1, parts: [{ kind: 'prompt', text: long }], messages: [] }).end('x');
    await trace.flush();
    assert.equal(saved.length, 1);
  });

  it('a failed turn is marked, and a failing save or listener never throws', async () => {
    const trace = createTrace({ scope: 's', kind: 'turn', save: async () => { throw new Error('offline'); }, onStep: () => { throw new Error('panel bug'); } });
    trace.step('input', {});
    trace.fail(Object.assign(new Error('cut off'), { type: 'truncated' }));
    const result = await trace.flush();
    assert.equal(result.ok, false);
    assert.equal(trace.steps.at(-1).error.type, 'truncated');
  });

  it('an oversized part is cut and says so', async () => {
    const { trace, saved } = recorder();
    trace.begin({ agent: 'coach', model: 'm', maxTokens: 1, parts: [{ kind: 'knowledgeBase', text: 'k'.repeat(MAX_PART_CHARS + 10) }], messages: [] }).end('x');
    await trace.flush();
    assert.equal(saved[0][1].text.length, MAX_PART_CHARS);
    assert.equal(saved[1][1].steps[0].system[0].cut, true);
  });
});

describe('rulesApplied', () => {
  const kb = (o) => ({ objectives: [{}, {}], objectivesMet: [], progress: 3, activitiesCompleted: 2, ...o });
  it('names each code rule that shaped the result', () => {
    const rules = (o) => rulesApplied(o).rules;
    assert.deepEqual(rules({ before: kb(), after: kb({ progress: 9, objectivesMet: [0] }), modelProgress: 10, parsed: { progress: 10 } }), ['cappedAt9']);
    assert.deepEqual(rules({ before: kb(), after: kb({ progress: 10, status: 'completed', objectivesMet: [0, 1] }), modelProgress: 10, parsed: { progress: 10 }, achieved: true }), ['completed']);
    assert.deepEqual(rules({ before: kb(), after: kb({ progress: 8 }), modelProgress: 10, parsed: { progress: 8 }, assessment: { held: true, unverified: 1, replaced: true } }), ['heldAt8', 'objectivesNotBackedUp', 'replyReplaced']);
    assert.deepEqual(rules({ before: kb(), after: kb(), modelProgress: null, parsed: { progress: null } }), ['noProgressTag']);
    assert.deepEqual(rules({ before: kb({ status: 'completed' }), after: kb({ status: 'completed' }), modelProgress: 4, parsed: { progress: 4 } }), ['frozenAfterCompletion']);
    assert.deepEqual(rules({ before: kb(), after: kb(), modelProgress: 5, parsed: { progress: 5 }, assessment: { failed: true } }), ['checkFailedNothingCounted']);
    assert.deepEqual(rules({ before: kb(), after: kb(), modelProgress: 10, parsed: { progress: 10 }, assessment: { failed: true, failedOpen: true }, achieved: true }), ['checkFailedTwiceGradingStood', 'completed']);
    assert.deepEqual(rules({ before: kb(), after: kb(), modelProgress: 14, parsed: { progress: 14 } }), ['clamped', 'cappedAt9']);
    assert.deepEqual(rules({ before: kb({ insights: Array(10).fill('n') }), after: kb(), modelProgress: 4, parsed: { progress: 4, kbUpdate: { insights: ['new'] } } }), ['notesFolded']);
  });

  it('reports before and after for the things a person asks about', () => {
    const out = rulesApplied({ before: kb(), after: kb({ progress: 6, objectivesMet: [0], activitiesCompleted: 3, learnerPosition: 'here' }), modelProgress: 6, parsed: { progress: 6 }, newlyMet: ['Can a'] });
    assert.deepEqual(out.progress, { before: 3, after: 6 });
    assert.deepEqual(out.exchanges, { before: 2, after: 3 });
    assert.deepEqual(out.objectivesMet, { before: [], after: [0], total: 2 });
    assert.deepEqual(out.newlyMet, ['Can a']);
  });
});
