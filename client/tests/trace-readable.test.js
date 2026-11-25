/**
 * The Trace stays accurate and readable as plato changes (#595):
 *
 * - Every call says where it belongs (stage, and check for a check's call),
 *   and every result names the call it came from: nothing is guessed.
 * - Each call records the agent's whole prompt header.
 * - Rules are worked out from what a turn recorded, so an old trace whose
 *   stored conclusion was wrong reads correctly (Blake's 2026-11-23 lesson:
 *   8 turns wrongly said "your score didn't change").
 * - Instructions plato's code adds to steer the coach are listed where plato
 *   stepped in.
 * - The view's wording doesn't restate numbers or tag names the code owns.
 * - An exchange, unopened, is short.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { store, ai, LESSON, reset, signIn, settle } from './helpers/fake-plato.js';

const { clearCache, savePreferences } = await import('../js/storage.js');
const { startLesson, sendMessage, COACH_TAGS, COACH_TAIL } = await import('../src/lib/lessonEngine.js');
const { describeTrace, deriveRules } = await import('../src/lib/traceView.js');
const { CHECKS, STAGES } = await import('../src/lib/transparency.js');
const { DRAFT_WORDS } = await import('../src/lib/assessment.js');
const { parseAgentHeader } = await import('../js/agentHeader.js');

const ID = LESSON.lessonId;
const noop = () => {};
const SCRIPT = ['My first answer.', 'MOCK_NOTAGS A second thought.', 'MOCK_COMPLETE MOCK_UNBACKED done?', 'MOCK_COMPLETE I applied it to my garden plan.', 'Thanks!'];

async function recorded(script = SCRIPT) {
  reset(); clearCache(); signIn();
  await savePreferences({ name: '', traceScopes: [ID] });
  ai.length = 0;
  await startLesson(ID, LESSON, noop);
  for (const text of script) await sendMessage(ID, LESSON, text, null, [], noop);
  await settle();
  const items = [...store.keys()].filter((k) => k.startsWith(`trace:${ID}:`)).map((dataKey) => ({ dataKey, data: store.get(dataKey) }));
  return { items, records: items.filter((i) => /:[tb]:/.test(i.dataKey)).map((i) => i.data) };
}

// What each result step reads, by the agent whose call it came from.
const RESULT_AGENT = {
  planned: ['lesson-owner'], validation: ['lesson-owner'], parsed: ['coach'], tagRepair: ['coach'], draftGuard: ['coach'], heldRewrite: ['coach'],
  verdict: ['assessor'], recheck: ['assessor'], gradingRetry: ['assessor'], claimCheck: ['claim-check'],
  profileSaved: ['learner-profile-update', 'learner-profile-owner'], unitNoteSaved: ['course-progress-update'],
};

describe('nothing is guessed', () => {
  it('every call names its stage, a check’s call names its check, and every result names its call', async () => {
    const { records } = await recorded();
    let calls = 0; let results = 0;
    for (const r of records) {
      const byN = new Map(r.steps.filter((s) => s.type === 'call').map((s) => [s.n, s]));
      for (const s of r.steps) {
        if (s.type === 'call') {
          calls++;
          assert.ok(s.stage in STAGES, `${s.agent} (${s.purpose}) names a stage`);
          if (s.stage === 'checked') assert.ok(s.check in CHECKS, `${s.agent} (${s.purpose}) names its check`);
        }
        if (RESULT_AGENT[s.type] && !(s.type === 'claimCheck' && s.byPattern)) {
          results++;
          const call = byN.get(s.call);
          assert.ok(call, `${s.type} names the call it came from`);
          assert.ok(RESULT_AGENT[s.type].includes(call.agent), `${s.type} came from ${call.agent}`);
        }
      }
    }
    assert.ok(calls > 8 && results > 5, `the script exercised enough (${calls} calls, ${results} results)`);
  });

  it('each call records the agent’s whole header, as its prompt file has it', async () => {
    const { records } = await recorded(['My first answer.']);
    const prompts = new URL('../prompts/', import.meta.url);
    for (const call of records.flatMap((r) => r.steps.filter((s) => s.type === 'call'))) {
      const header = parseAgentHeader(readFileSync(new URL(`${call.agent}.md`, prompts), 'utf8'));
      assert.deepEqual(call.about, { name: header.name, purpose: header.purpose, runs: header.runs, reads: header.reads, returns: header.returns }, call.agent);
    }
  });

  it('every prompt file’s header has all five fields', () => {
    const dir = new URL('../prompts/', import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const h = parseAgentHeader(readFileSync(new URL(f, dir), 'utf8'));
      assert.ok(h?.name && h.purpose && h.runs && h.reads.length && h.returns.length, `${f}: AGENT, PURPOSE, RUNS, READS, RETURNS`);
    }
  });

  it('the coach’s parse records the tags it looked for, and the thresholds in force are on their steps', async () => {
    const { records } = await recorded(['My first answer.']);
    const turn = records.find((r) => r.kind === 'turn');
    assert.deepEqual(turn.steps.find((s) => s.type === 'parsed').tags, COACH_TAGS);
    assert.equal(turn.steps.find((s) => s.type === 'tail').limit, COACH_TAIL);
    assert.equal(turn.steps.find((s) => s.type === 'draftCheck').minWords, DRAFT_WORDS);
  });
});

describe('old records read correctly', () => {
  // The 2026-11-23 record format: rules stored at record time, before #609,
  // from the coach's first reply rather than after its tags were repaired.
  const turn = (extra = []) => ({
    at: 2, kind: 'turn', app: { build: '20261123T1933', by: 'self' },
    steps: [
      { n: 1, type: 'input', ms: 0, text: 'It is my work horse for coding', images: [], links: [] },
      { n: 2, type: 'context', ms: 1, context: { learnerName: 'Ada', progress: 2, activitiesCompleted: 8, ...Object.fromEntries(extra) } },
      { n: 3, type: 'call', ms: 2, agent: 'coach', purpose: 'reply', model: 'm', maxTokens: 2048, stream: true, system: [{ kind: 'prompt', chars: 5, text: 'Coach' }], messages: { base: 0, extra: [] }, attempts: [], reply: 'Good. What next?', took: 1600 },
      { n: 4, type: 'parsed', ms: 3, raw: 'Good. What next?', text: 'Good. What next?', progress: null, kbUpdate: null, profileUpdate: null },
      { n: 5, type: 'call', ms: 4, agent: 'coach', purpose: 'tag repair', model: 'm', maxTokens: 600, system: [{ kind: 'prompt', chars: 5, text: 'Coach' }], messages: { base: 0, extra: [] }, attempts: [], reply: '[PROGRESS: 3]', took: 2500 },
      { n: 6, type: 'tagRepair', ms: 5, missing: null, recovered: true, progress: 3, kbUpdate: { insights: ['x'] }, profileUpdate: null },
      { n: 7, type: 'applied', ms: 6, modelProgress: null, replyProgress: 3, gradedProgress: 3, progress: { before: 2, after: 3 }, status: { before: 'active', after: 'active' }, objectivesMet: { before: [], after: [0], total: 3 }, exchanges: { before: 8, after: 9 }, learnerPosition: { before: 'a', after: 'b' }, rules: ['noProgressTag'] },
      { n: 8, type: 'shown', ms: 7, text: 'Good. What next?', firstStreamed: 'Good. What next?', replaced: false },
    ],
  });
  const view = (t) => describeTrace([{ dataKey: 'trace:x:t:2', data: t }]).exchanges[0];

  it('a repaired turn whose score went up doesn’t say the score didn’t change', () => {
    const e = view(turn());
    assert.deepEqual(deriveRules(turn().steps), []);
    assert.ok(!e.steps.find((s) => s.type === 'applied').rules.some((r) => r.id === 'noProgressTag'));
    assert.ok(!e.wentWrong, 'no "something went wrong"');
    assert.ok(e.interventions.some((x) => /asked the coach again/.test(x.text)), 'the repair is where plato stepped in');
    assert.equal(e.verdict.source, 'instructions');
  });

  it('a pacing instruction plato’s code added is listed where plato stepped in, and the reply isn’t called the model’s own', () => {
    const e = view(turn([['pacingDirective', 'Approaching target. Converge toward the exemplar.']]));
    assert.ok(e.interventions.some((x) => /added an instruction for the coach: a pacing instruction \(after 8 exchanges; lessons are designed for about \d+\)/.test(x.text)));
    assert.match(e.verdict.text, /followed an instruction plato’s code added: a pacing instruction/);
  });

  it('the whole conversation is counted: repairs, their time, steering', () => {
    const t1 = turn(); const t2 = { ...turn([['pacingDirective', 'Wrap up.']]), at: 3 };
    const { summary } = describeTrace([{ dataKey: 'trace:x:t:2', data: t1 }, { dataKey: 'trace:x:t:3', data: t2 }]);
    assert.deepEqual(summary.items.map((i) => [i.id, i.exchanges.length]), [['tags', 2], ['pacingDirective', 1]]);
    assert.match(summary.items[0].text, /2 times \(5\.0 s in all\)/);
  });
});

describe('the wording doesn’t restate what the code owns', () => {
  const sources = ['../src/lib/traceView.js', '../src/lib/transparency.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
  // Everything but comments (template strings nest, so they can't be picked out reliably).
  const prose = sources.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('no tag name, conversation length or draft threshold is written out', () => {
    for (const tag of Object.values(COACH_TAGS)) assert.doesNotMatch(prose, new RegExp(`\\[${tag}\\b`), `[${tag}] comes from the parse step`);
    assert.doesNotMatch(prose, new RegExp(`\\b(last|latest) ${COACH_TAIL}\\b`), 'the tail size comes from the tail step');
    assert.doesNotMatch(prose, new RegExp(`\\b${DRAFT_WORDS} or more words`), 'the draft threshold comes from the draft check');
    assert.doesNotMatch(prose, /PNG, JPEG|30 AI calls|4 AI calls/, 'limits come from what was recorded');
  });
});

describe('readable', () => {
  it('an unopened exchange is short: no more than about 100 words besides what you sent and saw', async () => {
    const { items } = await recorded();
    for (const e of describeTrace(items).exchanges) {
      const verdict = e.interventions.length ? e.verdict.lead : e.verdict.text;
      const shown = [e.headline, verdict, ...e.interventions.map((x) => x.text), 'Every step'].join(' ');
      const words = shown.split(/\s+/).filter(Boolean).length;
      assert.ok(words <= 100, `exchange ${e.n} shows ${words} words before anything is opened`);
    }
  });
});
