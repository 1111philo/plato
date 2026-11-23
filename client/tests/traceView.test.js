/**
 * The Trace view's wording (#595): real recorded lessons, described.
 * Every step must come out as a plain sentence with who decided it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { store, LESSON, reset, signIn, settle } from './helpers/fake-plato.js';

const { clearCache, savePreferences } = await import('../js/storage.js');
const { startLesson, sendMessage } = await import('../src/lib/lessonEngine.js');
const { describeTrace } = await import('../src/lib/traceView.js');
const { STEPS } = await import('../src/lib/transparency.js');

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
    for (const turn of view.turns) {
      assert.ok(turn.title && turn.verdict.text && turn.verdict.sourceLabel);
      for (const s of turn.steps) {
        seen.add(s.type);
        assert.ok(s.title, `${s.type} has no title`);
        assert.ok(s.summary && !/undefined|\[object Object\]|NaN/.test(s.summary), `${s.type}: "${s.summary}"`);
        assert.ok(['model', 'instructions', 'code', 'person'].includes(s.source));
        for (const d of s.details) assert.ok(d.label && typeof d.text === 'string' && !/\[object Object\]/.test(d.text), `${s.type} detail ${d.label}`);
      }
    }
    // The script reaches most of what a lesson can do.
    for (const t of ['lesson', 'planned', 'validation', 'plugins', 'input', 'state', 'tail', 'context', 'history', 'call', 'parsed', 'tagRepair', 'gradingPlan', 'verdict', 'verdictApplied', 'heldRewrite', 'claimCheck', 'applied', 'save', 'event', 'followUp', 'followUpStart', 'profileSaved', 'shown']) {
      assert.ok(seen.has(t), `the script never recorded "${t}"`);
    }
    assert.ok([...seen].every((t) => STEPS[t]));
  });

  it('orders turns, titles them from what the learner wrote, and puts follow-ups after their turn', async () => {
    const view = await record(['My first answer.']);
    assert.deepEqual(view.turns.map((t) => t.kind), ['start', 'turn', 'followup']);
    assert.equal(view.turns[0].title, 'Lesson start');
    assert.equal(view.turns[1].title, 'Your message: “My first answer.”');
    assert.match(view.turns[2].title, /^Follow-up: Learner profile/);
  });

  it('says who shaped each result: the model, plato’s instructions, or plato’s code', async () => {
    const view = await record(['My first answer.', 'MOCK_NOTAGS A second thought.', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_COMPLETE I applied it to my garden plan.']);
    const turns = view.turns.filter((t) => t.kind === 'turn');
    assert.equal(turns[0].verdict.source, 'model');
    assert.match(turns[0].verdict.text, /plato’s code changed nothing/);
    assert.equal(turns[1].verdict.source, 'instructions');
    assert.equal(turns[2].verdict.source, 'code');
    assert.match(turns[2].verdict.text, /Completion was held/);
    assert.equal(turns[3].verdict.source, 'model');
  });

  it('gathers the things worth a look', async () => {
    const view = await record(['MOCK_NOTAGS first', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_TRUNCATE more']);
    const ids = view.flags.map((f) => f.id);
    for (const id of ['tags', 'held', 'failed', 'cutOff']) assert.ok(ids.includes(id), `no "${id}" flag in ${ids}`);
    assert.ok(view.flags.every((f) => f.text && f.turnTitle));
    const held = view.turns.find((t) => t.flags.some((f) => f.id === 'held'));
    const shown = held.steps.find((s) => s.type === 'shown');
    assert.ok(shown.change.before && shown.change.after && shown.change.before !== shown.change.after, 'the replaced reply is shown before and after');
    const applied = held.steps.find((s) => s.type === 'applied');
    assert.ok(applied.rules.some((r) => r.id === 'heldAt8' && /held/.test(r.text)));
  });

  it('shows exactly what the model was given and what it said', async () => {
    const view = await record(['My first answer.']);
    const call = view.turns[1].steps.find((s) => s.type === 'call');
    assert.match(call.title, /^Coach: reply$/);
    assert.match(call.summary, /stand-in model used for testing/);
    const labels = call.details.map((d) => d.label);
    assert.ok(labels.some((l) => /^Instructions: The agent’s instructions \(plato’s instructions\)$/.test(l)));
    assert.ok(labels.some((l) => /^Instructions: Program knowledge base \(A person\)$/.test(l)));
    assert.match(call.details.find((d) => /^Messages sent/.test(d.label)).text, /My first answer\./);
    assert.match(call.details.find((d) => d.label === 'The model’s raw reply').text, /\[PROGRESS: \d+\]/);
    assert.match(call.details.find((d) => d.label === 'The model’s own reasoning').text, /None was returned/);
    const context = view.turns[1].steps.find((s) => s.type === 'context');
    assert.ok(context.details.some((d) => d.label === 'Your first name (A person)' && d.text === 'Ada'));
  });

  it('tolerates an empty or unknown trace', () => {
    assert.deepEqual(describeTrace([]), { turns: [], flags: [], partial: false });
    assert.deepEqual(describeTrace(null).turns, []);
    const odd = describeTrace([{ dataKey: 'trace:x:t:1', data: { at: 1, kind: 'turn', steps: [{ n: 1, type: 'somethingNew', ms: 0 }] } }]);
    assert.equal(odd.turns[0].steps[0].title, 'somethingNew');
  });
});
