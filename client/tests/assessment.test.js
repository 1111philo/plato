/**
 * The grading check (#584): what gets checked, the grounding of the
 * assessor's quotes, held completions, and the every-objective rule.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; }, clear() { this._store = {}; },
};
globalThis.fetch = async () => ({ ok: false, status: 404 });

const {
  assessmentPlan, assessmentTranscript, assessmentInput, groundVerdict, applyVerdict,
  parseVerdict, allObjectivesMet, heldCompletionAddendum, normalizeForMatch, HELD_PROGRESS,
} = await import('../src/lib/assessment.js');
const { applyCoachResponseToKB, checkGrading } = await import('../src/lib/lessonEngine.js');
const { coachTurnActivity } = await import('../src/lib/agentActivity.js');
const { mergeObjectivesMet } = await import('../src/lib/lessonWork.js');
// What sendMessage does with a graded reply: merge the checklist, then apply.
const finish = (k, parsed) => applyCoachResponseToKB(mergeObjectivesMet(k, parsed.kbUpdate), parsed);

const kb = (over = {}) => ({
  status: 'active', progress: 6, activitiesCompleted: 4, objectivesMet: [0],
  objectives: [
    { objective: 'Can reflect on a professional experience', evidence: 'Describes a real moment and what it meant' },
    { objective: 'Can explain why a value matters to them', evidence: 'Names a value and says why' },
    { objective: 'Can write a short message in their own words', evidence: 'Writes the message themselves' },
  ],
  ...over,
});
const lesson = { exemplar: 'A short Slack message that reflects who they are' };

// The issue's first screenshot, paraphrased: the coach writes the message,
// the learner says it's them.
const coachDrafted = [
  { role: 'user', content: '{"lessonName":"…"}' }, { role: 'assistant', content: 'Ready.' },
  { role: 'user', content: 'When I work on projects I look at the big picture and ask the questions nobody else asked, because different experiences broaden my view.' },
  { role: 'assistant', content: 'Try this revision: "I’m the person who looks at the big picture and asks questions about things others haven’t considered, because different experiences broaden my perspective." Does that feel like you?' },
  { role: 'user', content: 'That is me' },
];

describe('assessmentPlan', () => {
  it('checks only newly claimed objectives on an ordinary turn', () => {
    const plan = assessmentPlan(kb(), { progress: 7, kbUpdate: { objectivesMet: [1, 2] } });
    assert.deepEqual(plan, { check: [2], claimed: [2], completionClaimed: false });
  });
  it('checks every unmet objective when the reply scores 10', () => {
    const plan = assessmentPlan(kb(), { progress: 10, kbUpdate: { objectivesMet: [3] } });
    assert.deepEqual(plan.check, [2, 3]);
    assert.equal(plan.completionClaimed, true);
  });
  it('checks nothing on a completed lesson, a lesson without objectives, or a turn with no new claims', () => {
    assert.deepEqual(assessmentPlan(kb({ status: 'completed' }), { progress: 10 }).check, []);
    assert.deepEqual(assessmentPlan({ status: 'active' }, { progress: 10 }).check, []);
    assert.deepEqual(assessmentPlan(kb(), { progress: 7, kbUpdate: { objectivesMet: [1] } }).check, []);
  });
  it('ignores out-of-range and junk objective numbers', () => {
    assert.deepEqual(assessmentPlan(kb(), { progress: 7, kbUpdate: { objectivesMet: [0, 9, 'x', 2.5] } }).check, []);
  });
});

describe('assessmentTranscript and assessmentInput', () => {
  it('labels speakers, drops the context pair, and keeps link page text out of the learner’s words', () => {
    const t = assessmentTranscript([
      { role: 'user', content: '{ctx}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: [
        { type: 'text', text: 'Here is my site' },
        { type: 'text', text: '[REFERENCE CONTEXT — Learner attached a web page for your review]\nPage: x\n\nPAGE BODY' },
        { type: 'image', source: {} },
      ] },
    ]);
    assert.deepEqual(t, [{ by: 'learner', text: 'Here is my site\n[attached a web page]\n[image]' }]);
  });
  it('sends objective wording and evidence only, numbered from 1', () => {
    const input = JSON.parse(assessmentInput({ lesson, kb: kb(), transcript: [], check: [2] }));
    assert.equal(input.objectives[1].n, 2);
    assert.equal(input.objectives[1].evidence, 'Names a value and says why');
    assert.deepEqual(input.check, [2]);
    assert.equal(input.imageThisTurn, false);
    assert.equal('progress' in input, false);
  });
});

describe('groundVerdict', () => {
  const transcript = assessmentTranscript(coachDrafted);

  it('throws out a "shown" whose quote is coach-written text the learner only agreed to', () => {
    const verdict = { objectives: [
      { n: 3, shown: true, quote: 'I’m the person who looks at the big picture and asks questions about things others haven’t considered' },
    ] };
    const g = groundVerdict(verdict, transcript, [3]);
    assert.deepEqual(g.shown, []);
    assert.match(g.missing[3], /written by the coach/);
  });
  it('throws out an agreement quote that isn’t in any learner message, and a made-up quote', () => {
    const g = groundVerdict({ objectives: [{ n: 2, shown: true, quote: 'diversity is my core value' }] }, transcript, [2]);
    assert.deepEqual(g.shown, []);
  });
  it('keeps a quote from the learner’s own words, tolerating case, punctuation, and a dropped word', () => {
    const g = groundVerdict({ objectives: [
      { n: 1, shown: true, quote: 'I look at the big picture and ask the questions nobody asked' },
    ] }, transcript, [1]);
    assert.deepEqual(g.shown, [1]);
  });
  it('accepts "[image]" only when this turn has an image', () => {
    const v = { objectives: [{ n: 2, shown: true, quote: '[image]' }] };
    assert.deepEqual(groundVerdict(v, transcript, [2], { imageThisTurn: true }).shown, [2]);
    assert.deepEqual(groundVerdict(v, transcript, [2]).shown, []);
  });
  it('treats objectives the assessor skipped as not shown, with its reason when given', () => {
    const g = groundVerdict({ objectives: [{ n: 2, shown: false, missing: 'say why the value matters' }] }, transcript, [2, 3]);
    assert.equal(g.missing[2], 'say why the value matters');
    assert.ok(g.missing[3]);
  });
});

describe('applyVerdict', () => {
  it('holds a completion when an objective isn’t shown, capping the score', () => {
    const plan = { check: [2, 3], claimed: [2, 3], completionClaimed: true };
    const r = applyVerdict({ progress: 10, kbUpdate: { objectivesMet: [1, 2, 3], insights: ['x'] } }, kb(), plan, { shown: [2], missing: { 3: 'm' } });
    assert.equal(r.held, true);
    assert.equal(r.parsed.progress, HELD_PROGRESS);
    assert.deepEqual(r.parsed.kbUpdate.objectivesMet, [1, 2]);
    assert.deepEqual(r.unverified, [3]);
    assert.deepEqual(r.outstanding, [3]);
    assert.deepEqual(r.parsed.kbUpdate.insights, ['x']);
  });
  it('adds objectives the check found on a completing turn even when the coach didn’t list them', () => {
    const plan = { check: [2, 3], claimed: [], completionClaimed: true };
    const r = applyVerdict({ progress: 10, kbUpdate: null }, kb(), plan, { shown: [2, 3], missing: {} });
    assert.equal(r.held, false);
    assert.equal(r.parsed.progress, 10);
    assert.deepEqual(r.parsed.kbUpdate.objectivesMet, [2, 3]);
  });
});

describe('parseVerdict', () => {
  it('reads fenced or wrapped JSON and throws when there is none', () => {
    assert.deepEqual(parseVerdict('```json\n{"objectives":[]}\n```'), { objectives: [] });
    assert.deepEqual(parseVerdict('Here you go: {"objectives":[{"n":1}]} done'), { objectives: [{ n: 1 }] });
    assert.throws(() => parseVerdict('no json here'));
  });
});

describe('the every-objective rule (applyCoachResponseToKB)', () => {
  it('does not complete a lesson while an objective is unchecked, whatever the score', () => {
    const r = applyCoachResponseToKB(kb({ objectivesMet: [0, 1] }), { progress: 10, kbUpdate: null });
    assert.equal(r.achieved, false);
    assert.equal(r.lessonKB.status, 'active');
    assert.equal(r.lessonKB.progress, 9);
  });
  it('completes once every objective is checked off', () => {
    const r = applyCoachResponseToKB(kb({ objectivesMet: [0, 1, 2] }), { progress: 10, kbUpdate: null });
    assert.equal(r.achieved, true);
    assert.equal(r.lessonKB.status, 'completed');
  });
  it('allObjectivesMet is true for a lesson without objectives', () => {
    assert.equal(allObjectivesMet({}), true);
    assert.equal(allObjectivesMet(kb({ objectivesMet: [0, 2] })), false);
  });
});

describe('checkGrading', () => {
  const notShown = JSON.stringify({ objectives: [
    { n: 2, shown: false, missing: 'say why the value matters to them' },
    { n: 3, shown: true, quote: 'I’m the person who looks at the big picture and asks questions about things others haven’t considered' },
  ] });

  it('holds the screenshot’s "That is me" completion and replaces the reply with the coach’s second try', async () => {
    let addendum = null;
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Perfect. You’ve nailed the exemplar.', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => notShown,
      regenerate: async (a) => { addendum = a; return 'You named the big picture yourself. Now, in your own words, what value drives that?\n[PROGRESS: 10]\n[KB_UPDATE: {"objectivesMet":[1,2,3],"insights":["y"]}]'; },
    });
    assert.match(addendum, /Objective 2/);
    assert.match(addendum, /Objective 3, .*written by the coach/);
    assert.equal(parsed.text.startsWith('You named the big picture'), true);
    assert.equal(parsed.progress, HELD_PROGRESS);
    // Objective 1 was already checked off; 2 and 3 weren't backed up.
    assert.deepEqual(parsed.kbUpdate.objectivesMet, [1]);
    assert.deepEqual(assessment, { checked: 2, shown: 0, unverified: 2, held: true, regenerated: true });
    // And the rule keeps the lesson open.
    const applied = finish(kb(), parsed);
    assert.equal(applied.achieved, false);
    assert.deepEqual(applied.lessonKB.objectivesMet, [0]);
  });

  it('lets a genuine completion through without a second try', async () => {
    let regenerated = false;
    const genuine = [...coachDrafted.slice(0, 4), { role: 'user', content: 'I care about fairness because I grew up translating for my parents. Hi all, I’m Sam: I’m the one who asks the question nobody asked yet.' }];
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: genuine,
      parsed: { text: 'Done!', progress: 10, kbUpdate: { objectivesMet: [2, 3] } },
      assess: async () => JSON.stringify({ objectives: [
        { n: 2, shown: true, quote: 'I care about fairness because I grew up translating for my parents' },
        { n: 3, shown: true, quote: 'I’m the one who asks the question nobody asked yet' },
      ] }),
      regenerate: async () => { regenerated = true; return ''; },
    });
    assert.equal(regenerated, false);
    assert.equal(parsed.progress, 10);
    assert.equal(assessment.held, false);
    assert.equal(finish(kb(), parsed).achieved, true);
  });

  it('falls back to the coach’s grading when the check fails, so completion still works', async () => {
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Done', progress: 10, kbUpdate: null },
      assess: async () => { throw new Error('busy'); },
      regenerate: async () => '',
    });
    assert.deepEqual(assessment, { failed: true, checked: 2 });
    assert.deepEqual(parsed.kbUpdate.objectivesMet, [1, 2, 3]);
    assert.equal(finish(kb(), parsed).achieved, true);
  });

  it('asks the assessor once more when its first reply isn’t JSON', async () => {
    let calls = 0;
    const { assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => (++calls === 1 ? 'Sure! Here is my assessment.' : notShown),
      regenerate: async () => 'Say it in your own words.\n[PROGRESS: 7]',
    });
    assert.equal(calls, 2);
    assert.equal(assessment.failed, undefined);
    assert.equal(assessment.held, true);
  });

  it('keeps the first reply (completion still held) when the second try fails', async () => {
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => notShown,
      regenerate: async () => { throw new Error('stream failed'); },
    });
    assert.equal(parsed.text, 'Nailed it');
    assert.equal(parsed.progress, HELD_PROGRESS);
    assert.equal(assessment.regenerated, false);
  });

  it('does nothing on a turn with no new claims', async () => {
    let called = false;
    const r = await checkGrading({ lesson, kb: kb(), messages: coachDrafted, parsed: { progress: 6 }, assess: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(r.assessment, null);
  });
});

describe('disclosure (Behind this response)', () => {
  it('reports counts and a held lesson, never the reasons', () => {
    const agents = coachTurnActivity({ before: kb(), after: kb(), parsed: {}, assessment: { checked: 2, shown: 1, unverified: 0, held: true, regenerated: true } });
    const check = agents.find((a) => a.agent === 'assessor');
    assert.equal(check.label, 'Assessment check');
    assert.deepEqual(check.did, ['Checked 2 objectives against your own words: 1 shown', 'Held the lesson open until the rest is in your own words, and asked the coach to reply again']);
  });
  it('says plainly when the check could not run', () => {
    const agents = coachTurnActivity({ before: kb(), after: kb(), parsed: {}, assessment: { failed: true, checked: 1 } });
    assert.match(agents.find((a) => a.agent === 'assessor').did[0], /coach’s assessment stands/);
  });
});

describe('heldCompletionAddendum and normalizeForMatch', () => {
  it('names each outstanding objective and caps the score', () => {
    const a = heldCompletionAddendum(kb(), [3], { 3: 'write the message themselves' });
    assert.match(a, /Objective 3, "Can write a short message in their own words": write the message themselves/);
    assert.match(a, new RegExp(`\\[PROGRESS\\] is ${HELD_PROGRESS} or lower`));
  });
  it('normalizes quotes, case, and punctuation', () => {
    assert.equal(normalizeForMatch('  I’M  “Sam”, hi! '), "i m sam hi");
  });
});
