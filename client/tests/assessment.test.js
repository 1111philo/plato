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
  claimsCompletion, draftsForLearner, mixesScripts, onlyAgrees, confirmingCounts, ONLY_AGREES, heldReply, heldPosition, objectiveForLearner, COACH_WROTE, closeSpelling, OWN_SHARE,
} = await import('../src/lib/assessment.js');
const { applyCoachResponseToKB, checkGrading, nextGradingFailures } = await import('../src/lib/lessonEngine.js');
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
  it('sends the objectives’ wording only, numbered from 1 (not the per-learner evidence notes)', () => {
    const input = JSON.parse(assessmentInput({ lesson, kb: kb(), transcript: [], check: [2] }));
    assert.equal(input.objectives[1].n, 2);
    assert.equal(input.objectives[1].objective, 'Can explain why a value matters to them');
    assert.equal('evidence' in input.objectives[1], false);
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
  it('keeps the learner’s words when the coach quoted them back afterwards (order matters)', () => {
    const t = assessmentTranscript([
      { role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: 'Agentic AI evaluates data, reasons through it, takes an action, and learns from the result.' },
      { role: 'assistant', content: 'Your definition, "Agentic AI evaluates data, reasons through it, takes an action, and learns from the result", is clear.' },
    ]);
    const quote = 'Agentic AI evaluates data, reasons through it, takes an action, and learns from the result';
    assert.deepEqual(groundVerdict({ objectives: [{ n: 1, shown: true, quote }] }, t, [1]).shown, [1]);
  });
  it('throws out the coach’s words when the learner pasted them back later', () => {
    const t = assessmentTranscript([
      { role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'assistant', content: 'Try: "I am the person who asks the questions nobody else in the room asks yet."' },
      { role: 'user', content: 'I am the person who asks the questions nobody else in the room asks yet.' },
    ]);
    const g = groundVerdict({ objectives: [{ n: 3, shown: true, quote: 'I am the person who asks the questions nobody else in the room asks yet' }] }, t, [3]);
    assert.deepEqual(g.shown, []);
    assert.match(g.missing[3], /written by the coach/);
  });
  it('needs a grounded quote for every part of an objective', () => {
    const t = assessmentTranscript([
      { role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: 'i don’t use ai tools for data analysis like claude. i need to upskill on this' },
    ]);
    const gap = { part: 'name a gap', quote: 'i don’t use ai tools for data analysis like claude' };
    // The model says shown, but the "why" part has no quote: not shown.
    const g = groundVerdict({ objectives: [{ n: 3, shown: true, parts: [gap, { part: 'explain why it matters for their goals', quote: null }] }] }, t, [3]);
    assert.deepEqual(g.shown, []);
    assert.match(g.missing[3], /explain why it matters/);
    // Every part quoted from the learner: shown.
    const ok = groundVerdict({ objectives: [{ n: 3, shown: true, parts: [gap, { part: 'why', quote: 'i need to upskill on this' }] }] }, t, [3]);
    assert.deepEqual(ok.shown, [3]);
  });
  it('checks each part of a quote joined with an ellipsis', () => {
    const t = assessmentTranscript([
      { role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: 'I have been a sonographer for 23 years and I like fixing schedules.' },
      { role: 'user', content: 'Now I want to use data and analytics to solve these problems.' },
    ]);
    const ok = groundVerdict({ objectives: [{ n: 1, shown: true, quote: 'I have been a sonographer for 23 years... Now I want to use data and analytics' }] }, t, [1]);
    assert.deepEqual(ok.shown, [1]);
    const bad = groundVerdict({ objectives: [{ n: 1, shown: true, quote: 'I have been a sonographer for 23 years… and I led the whole department' }] }, t, [1]);
    assert.deepEqual(bad.shown, []);
  });
  it('judges each piece of an ellipsis quote on its own order (a learner who pasted twice)', () => {
    const answer = 'Excel tracks our program budget so we stay under it this quarter. Slack keeps the field team in touch so I hear problems the same day.';
    const t = assessmentTranscript([
      { role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: answer },
      { role: 'assistant', content: 'You said: "Excel tracks our program budget so we stay under it this quarter." Good.' },
      { role: 'user', content: answer },
    ]);
    const quote = 'Excel tracks our program budget so we stay under it this quarter... Slack keeps the field team in touch so I hear problems the same day';
    assert.deepEqual(groundVerdict({ objectives: [{ n: 1, shown: true, quote }] }, t, [1]).shown, [1]);
  });
  it('a short phrase the coach used first doesn’t make the learner’s words the coach’s', () => {
    const t = assessmentTranscript([
      { role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' },
      { role: 'assistant', content: 'Is it efficiency for its own sake, or what it does for people?' },
      { role: 'user', content: 'Efficiency for its own sake. I rebuilt our schedule so staff got hurt less.' },
    ]);
    assert.deepEqual(groundVerdict({ objectives: [{ n: 2, shown: true, quote: 'Efficiency for its own sake' }] }, t, [2]).shown, [2]);
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

  it('fails closed when the check can’t run: nothing new is checked off and the lesson stays open (playground 2026-11-21)', async () => {
    let addendum = null;
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'You’ve demonstrated the exemplar. Well done.', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3, 4], learnerPosition: 'Has fully achieved the exemplar.' } },
      assess: async () => { throw new Error('busy'); },
      regenerate: async (a) => { addendum = a; return 'Nice work. You’ve demonstrated the exemplar!\n[PROGRESS: 10]\n[KB_UPDATE: {"learnerPosition":"All objectives demonstrated."}]'; },
    });
    assert.equal(assessment.failed, true);
    assert.equal(assessment.held, true);
    assert.match(addendum, /couldn’t be checked this turn/);
    assert.deepEqual(parsed.kbUpdate.objectivesMet, [1]);
    assert.equal(parsed.progress, HELD_PROGRESS);
    // The second try still said "done": plato's words replace it, and the note.
    assert.equal(assessment.replaced, true);
    assert.match(parsed.text, /isn't complete yet/);
    assert.match(parsed.kbUpdate.learnerPosition, /^Close to the exemplar/);
    assert.equal(finish(kb(), parsed).achieved, false);
  });

  it('lets the coach’s grading stand on the second completing turn in a row that can’t be checked, so no one is stuck', async () => {
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb({ gradingCheckFailures: 1 }), messages: coachDrafted,
      parsed: { text: 'Done!', progress: 10, kbUpdate: null },
      assess: async () => 'not json',
      regenerate: async () => { throw new Error('should not regenerate'); },
    });
    assert.equal(assessment.failedOpen, true);
    assert.equal(assessment.held, false);
    assert.deepEqual(parsed.kbUpdate.objectivesMet, [1, 2, 3]);
    assert.equal(finish(kb(), parsed).achieved, true);
  });

  it('the retry after a malformed reply asks with a higher temperature', async () => {
    const temps = [];
    await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'x', progress: 7, kbUpdate: { objectivesMet: [2] } },
      assess: async (_input, _images, opts) => { temps.push(opts?.temperature ?? 0); return temps.length === 1 ? 'nope' : JSON.stringify({ objectives: [{ n: 2, shown: false }] }); },
    });
    assert.deepEqual(temps, [0, 0.7]);
  });

  it('a failed check on an ordinary turn drops the coach’s new claims (fail closed)', async () => {
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Good.', progress: 7, kbUpdate: { objectivesMet: [2] } },
      assess: async () => 'not json',
    });
    assert.equal(assessment.failed, true);
    assert.equal(assessment.held, false);
    assert.deepEqual(parsed.kbUpdate.objectivesMet, []);
    // Objective 1 was already checked off and stays; 2 isn't added.
    assert.deepEqual(finish(kb(), parsed).lessonKB.objectivesMet, [0]);
  });

  it('repairs the curly-quote JSON the assessor wrote on playground instead of failing', async () => {
    const broken = '{\n "objectives": [\n {"n": 2, "parts": [{"part": "name a value", "quote": "I like hearing different people out because it changes how i see things”\n }], "shown": true}\n ]\n}';
    const t = assessmentTranscript([...coachDrafted.slice(0, 4)]);
    const v = parseVerdict(broken);
    assert.equal(v.objectives[0].parts[0].quote, 'I like hearing different people out because it changes how i see things');
    assert.deepEqual(groundVerdict(v, t, [2]).shown, []); // not in this transcript's learner text, but it parsed
  });

  it('retries a malformed verdict with a note saying so', async () => {
    const inputs = [];
    await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'x', progress: 7, kbUpdate: { objectivesMet: [2] } },
      assess: async (input) => { inputs.push(JSON.parse(input)); return inputs.length === 1 ? 'nope' : JSON.stringify({ objectives: [{ n: 2, shown: false }] }); },
    });
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].note, undefined);
    assert.match(inputs[1].note, /not valid JSON/);
  });

  it('asks the claim check about held wording the patterns miss, and replaces it on yes', async () => {
    const asked = [];
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => notShown,
      regenerate: async () => 'That’s a wrap on this one, nicely handled.\n[PROGRESS: 8]',
      judgeClaim: async (t) => { asked.push(t); return true; },
    });
    assert.equal(asked.length, 1);
    assert.equal(assessment.replaced, true);
    assert.match(parsed.text, /isn't complete yet/);
  });

  it('puts plato’s held message into the learner’s language when one is given, and keeps the English if that fails (AGENT_EVALS W7)', async () => {
    const run = (localize) => checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => notShown,
      regenerate: async () => 'This one is complete.\n[PROGRESS: 8]',
      judgeClaim: async () => true,
      localize,
    });
    const asked = [];
    const es = await run(async (addendum) => { asked.push(addendum); return 'Ya casi, pero esta lección aún no está completa.\n[PROGRESS: 8]'; });
    assert.match(asked[0], /learner's language/);
    assert.match(asked[0], /isn't complete yet/, 'translates plato’s own message');
    assert.equal(es.parsed.text, 'Ya casi, pero esta lección aún no está completa.', 'tags dropped');
    assert.equal(es.parsed.progress, 8);
    const failed = await run(async () => { throw new Error('busy'); });
    assert.match(failed.parsed.text, /isn't complete yet/);
    const english = await run(undefined);
    assert.match(english.parsed.text, /isn't complete yet/);
  });

  it('keeps a held reply when the claim check says no or fails', async () => {
    for (const judgeClaim of [async () => false, async () => { throw new Error('busy'); }]) {
      const { parsed, assessment } = await checkGrading({
        lesson, kb: kb(), messages: coachDrafted,
        parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
        assess: async () => notShown,
        regenerate: async () => 'In your own words, what value drives that?\n[PROGRESS: 8]',
        judgeClaim,
      });
      assert.equal(assessment.replaced, undefined);
      assert.match(parsed.text, /^In your own words/);
    }
  });

  it('replaces a held second try that still says the lesson is complete (playground 2026-11-21)', async () => {
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => notShown,
      regenerate: async () => 'Yes—go ahead and start the next lesson. This one is complete.\n[PROGRESS: 8]',
    });
    assert.equal(assessment.held, true);
    assert.equal(assessment.replaced, true);
    assert.match(parsed.text, /^You're close, but this lesson isn't complete yet\. Some of what you sent repeats my wording, and that doesn’t count as yours\. The next step is yours: \*\*explain why a value matters to you\*\*/);
  });

  it('asks the assessor once more when its first reply isn’t JSON', async () => {
    let calls = 0;
    const { assessment } = await checkGrading({
      lesson, kb: kb(), messages: coachDrafted,
      parsed: { text: 'Nailed it', progress: 10, kbUpdate: { objectivesMet: [1, 2, 3] } },
      assess: async () => (++calls === 1 ? 'Sure! Here is my assessment.' : notShown),
      regenerate: async () => 'Say it in your own words.\n[PROGRESS: 7]',
    });
    // Not JSON, then the verdict, then a recheck of objective 3 (its quote was the coach's).
    assert.equal(calls, 3);
    assert.equal(assessment.failed, undefined);
    assert.equal(assessment.held, true);
  });

  it('asks again about a "shown" whose quote was the coach’s, and keeps a grounded second answer', async () => {
    const inputs = [];
    const genuine = [...coachDrafted.slice(0, 4), { role: 'user', content: 'I care about fairness because I grew up translating for my parents. Hi all, I’m Sam: I’m the one who asks the question nobody asked yet.' }];
    const { parsed, assessment } = await checkGrading({
      lesson, kb: kb({ objectivesMet: [0, 2] }), messages: genuine,
      parsed: { text: 'Done!', progress: 10, kbUpdate: { objectivesMet: [2, 4] } },
      assess: async (input) => {
        inputs.push(JSON.parse(input));
        return inputs.length === 1
          ? JSON.stringify({ objectives: [
            { n: 2, shown: true, quote: 'I’m the person who looks at the big picture and asks questions about things others haven’t considered' },
            { n: 4, shown: true, quote: 'I’m the one who asks the question nobody asked yet' },
          ] })
          : JSON.stringify({ objectives: [{ n: 2, shown: true, quote: 'I care about fairness because I grew up translating for my parents' }] });
      },
      regenerate: async () => '',
    });
    assert.equal(inputs.length, 2);
    assert.deepEqual(inputs[1].check, [2]);
    assert.match(inputs[1].recheck[0].problem, /written by the coach/);
    assert.equal(assessment.held, false);
    assert.equal(parsed.progress, 10);
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
    assert.equal(check.label, 'Assessor');
    assert.deepEqual(check.did, ['Checked 2 objectives against your own words: 1 shown', 'Held the lesson open until the rest is in your own words, and asked the coach to reply again']);
  });
  it('says plainly when the check could not run', () => {
    const agents = coachTurnActivity({ before: kb(), after: kb(), parsed: {}, assessment: { failed: true, checked: 1 } });
    assert.match(agents.find((a) => a.agent === 'assessor').did[0], /nothing new was checked off/);
    const open = coachTurnActivity({ before: kb(), after: kb(), parsed: {}, assessment: { failed: true, failedOpen: true, checked: 1 } });
    assert.match(open.find((a) => a.agent === 'assessor').did[0], /coach’s assessment stands; the team can review it/);
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

describe('claimsCompletion and draftsForLearner (playground testing, 2026-11-21)', () => {
  it('catches the coach saying the lesson is done', () => {
    for (const t of [
      'Yes—go ahead and start the next lesson. This one is complete.',
      '**This is your exemplar.** You’ve met all objectives — including clear writing.',
      'You’ve fully mapped your tech stack… this meets all lesson objectives.',
      '**You’ve demonstrated the exemplar.** Let’s celebrate.',
      'Has fully achieved the exemplar: a memorable, authentic Slack message.',
      'Tech stack fully mapped with fluency ratings and gap explanation. All objectives demonstrated.',
      // Amanda, playground 2026-11-22: markdown inside the phrase, two adverbs.
      'You’ve now fully demonstrated the **exemplar**: a Personal Productivity Plan.\n\n**Progress: 10 — lesson complete.**',
      // Real prod completion messages the first patterns missed.
      'Now that you’ve wrapped this up — how did the lesson feel?',
      'You’re ready to move into portfolio building. How did the course feel overall?',
    ]) assert.equal(claimsCompletion(t), true, t);
  });
  it('doesn’t catch ordinary coaching', () => {
    for (const t of [
      'You’re close to the exemplar. Next, explain why that gap matters.',
      'You’ve met the first objective. Now name a value.',
      'What would make this message feel complete to you?',
      'When you finish this lesson, the next one builds on it.',
    ]) assert.equal(claimsCompletion(t), false, t);
  });
  it('catches a passage of 20+ words written for the learner to adopt', () => {
    for (const t of [
      'Here’s a draft combining both: “I build systems that scale, like the writing curriculum I designed that helped my 5th graders hit 100% on state tests, and I thrive when I collaborate.”',
      'Try: *“I designed a writing curriculum that empowered my colleagues to adapt and own it, and together we lifted student scores to 100% on the state ELA tests last spring.”*',
    ]) assert.equal(draftsForLearner(t), true, t);
  });
  it('lets shorter sample sentences through (the threshold is 20 words)', () => {
    for (const t of [
      'For example: “Capturing AI ideas in real time would let me reuse insights across lessons, saving 2 hours a week.”',
      'Try: “I complete 80% of my time-blocked tasks each week.”',
    ]) assert.equal(draftsForLearner(t), false, t);
  });
  it('allows short examples of the kind of thing meant', () => {
    for (const t of [
      'What software do you use most? For example: Claude, ChatGPT, VS Code.',
      'Think of something like “a deadline you hit” or “a process you fixed.”',
      'Your phrase **impact through iteration** is strong.',
    ]) assert.equal(draftsForLearner(t), false, t);
  });
});

describe('a quote put together from the coach’s sentences (agent evaluations W4)', () => {
  it('doesn’t count, and the coach polishing the learner’s own words still does', () => {
    const transcript = [
      { by: 'coach', text: 'Example: “It showed me I’m good at noticing what’s needed before it’s asked” or “I like knowing people can rely on me.” Try: change “helping a professor set up” to “when I organized the classroom early”, and “I’m good at noticing” to “I spot gaps before they become problems”.' },
      { by: 'learner', text: 'i’m sam, when i organized the classroom early, it showed me i spot gaps before they become problems, and i like knowing people can rely on me. use that' },
    ];
    const verdict = (quote) => ({ objectives: [{ n: 3, parts: [{ part: 'shape their story', quote }], shown: true }] });
    const q = 'i’m sam, when i organized the classroom early, it showed me i spot gaps before they become problems, and i like knowing people can rely on me';
    assert.equal(groundVerdict(verdict(q), transcript, [3]).missing[3], COACH_WROTE);
    const own = [
      { by: 'learner', text: 'i stayed late at the food bank to sort the donations because i hate seeing people wait' },
      { by: 'coach', text: 'Nice. Polished: “I stayed late at the food bank to sort the donations, because I hate seeing people wait.”' },
      { by: 'learner', text: 'I stayed late at the food bank to sort the donations, because I hate seeing people wait.' },
    ];
    assert.deepEqual(groundVerdict(verdict('I stayed late at the food bank to sort the donations, because I hate seeing people wait.'), own, [3]).shown, [3]);
    // The coach's example, sent back with the words it suggested swapping.
    const swapped = [
      { by: 'coach', text: 'For example: “StudioPress uses Genesis Framework to give people easy-to-use, SEO-ready website templates, so even beginners can build professional sites fast.” Swap “give people” for “provide” or “fast” for “quickly”.' },
      { by: 'learner', text: 'StudioPress uses Genesis Framework to provide easy-to-use, SEO-ready website templates, so even beginners can build professional sites quickly.' },
    ];
    assert.equal(groundVerdict(verdict('StudioPress uses Genesis Framework to provide easy-to-use, SEO-ready website templates, so even beginners can build professional sites quickly.'), swapped, [3]).missing[3], COACH_WROTE);
    // The coach quoting the learner back doesn't make the learner's words the coach's.
    const echoed = [
      { by: 'learner', text: 'I organised the food drive and it showed me I love bringing people together' },
      { by: 'coach', text: 'Great: “I organised the food drive and it showed me I love bringing people together.” Why does that matter?' },
    ];
    assert.deepEqual(groundVerdict(verdict('I organised the food drive and it showed me I love bringing people together'), echoed, [3]).shown, [3]);
  });
});

describe('a quote that only agrees (agent evaluations A17)', () => {
  it('knows agreement from evidence', () => {
    for (const q of ['Yes, that’s accurate, that’s me.', 'yes', 'Sounds good, post it', 'That is me', 'Perfect, use that', 'Sí, eso soy yo', 'Perfecto, úsalo']) assert.equal(onlyAgrees(q), true, q);
    assert.equal(onlyAgrees('Sí, ayudé en la colecta de comida'), false);
    for (const q of ['I came from retail.', 'Yes, I stayed late to fix the budget error', 'I value calm']) assert.equal(onlyAgrees(q), false, q);
  });
  it('doesn’t count it, unless the lesson says confirming counts', () => {
    const transcript = [{ by: 'coach', text: 'Here’s your intro: Hi, I’m Sam. Is that accurate?' }, { by: 'learner', text: 'Yes, that’s accurate, that’s me.' }];
    const verdict = { objectives: [{ n: 3, parts: [{ part: 'shape their story', quote: 'Yes, that’s accurate, that’s me.' }], shown: true }] };
    const plain = groundVerdict(verdict, transcript, [3]);
    assert.deepEqual(plain.shown, []);
    assert.equal(plain.missing[3], ONLY_AGREES);
    assert.deepEqual(plain.ungrounded, [3], 'asked again');
    const confirming = groundVerdict(verdict, transcript, [3], { confirms: new Set([3]) });
    assert.deepEqual(confirming.shown, [3]);
  });
  it('confirming counts where the objective or exemplar says the learner confirms', () => {
    assert.deepEqual([...confirmingCounts({ exemplar: 'A message.', objectives: [{ objective: 'Can describe goals' }, { objective: 'Can confirm a profile that is true to them' }] })], [2]);
    assert.deepEqual([...confirmingCounts({ exemplar: 'A profile the learner has confirmed.', objectives: [{ objective: 'a' }, { objective: 'b' }] })], [1, 2]);
    assert.deepEqual([...confirmingCounts({ exemplar: 'A message.', objectives: [{ objective: 'Can write it' }] })], []);
  });
});

describe('mixesScripts (agent evaluations C59)', () => {
  it('finds Chinese, Japanese or Korean characters in a reply in another language', () => {
    assert.equal(mixesScripts('tell me about one moment —哪怕很小— where you felt proud'), true);
    assert.equal(mixesScripts('Cuéntame un momento — aunque sea pequeño.', 'Spanish'), false);
    assert.equal(mixesScripts('একটি মুহূর্তের কথা বলুন', 'Bengali'), false);
    assert.equal(mixesScripts('Tell me about one moment.'), false);
  });
  it('a reply mostly not in the script of a learner’s language that has one (agent evaluations W8)', () => {
    assert.equal(mixesScripts('You’ve shared a strong, real moment — helping a stressed student find their book.', 'Bengali'), true);
    assert.equal(mixesScripts('আপনি একটি শক্তিশালী মুহূর্ত শেয়ার করেছেন। Foundations 1 এর পরের ধাপ কী?', 'Bengali'), false, 'a lesson name in English is fine');
    assert.equal(mixesScripts('Ok.', 'Bengali'), false, 'too short to tell');
    assert.equal(mixesScripts('You’ve shared a strong moment.', 'Spanish'), false, 'Latin-script languages aren’t judged by script');
  });
  it('leaves those scripts alone for learners who read them', () => {
    assert.equal(mixesScripts('一个小时刻', 'Chinese'), false);
    assert.equal(mixesScripts('小さな瞬間', 'Japanese'), false);
    assert.equal(mixesScripts('작은 순간', 'Korean'), false);
  });
});

describe('nextGradingFailures', () => {
  it('counts completing turns in a row the check couldn’t run, and resets when it runs', () => {
    assert.equal(nextGradingFailures(0, { failed: true, held: true }), 1);
    assert.equal(nextGradingFailures(1, { failed: true, failedOpen: true }), 0);
    assert.equal(nextGradingFailures(1, { failed: true, held: false }), 1);
    assert.equal(nextGradingFailures(1, { checked: 2, shown: 2, held: false }), 0);
    assert.equal(nextGradingFailures(1, null), 1);
  });
});

describe('held reply copy (playground 2026-11-23)', () => {
  const k = { objectives: [
    { objective: 'Can upload a screenshot of their passing ticket' },
    { objective: 'Can state one specific, actionable career goal and confirm their profile' },
    { objective: 'Can explain why a value matters to them in their own words' },
  ] };

  it('turns an objective about the learner into a step addressed to them', () => {
    assert.equal(objectiveForLearner(k.objectives[1]), 'state one specific, actionable career goal and confirm your profile');
    assert.equal(objectiveForLearner('Can explain why a value matters to them in their own words'), 'explain why a value matters to you in your own words');
  });

  it('never shows the coach-facing reason', () => {
    const t = heldReply(k, [2], { 2: COACH_WROTE });
    assert.doesNotMatch(t, /written by the coach|the learner|their profile/);
    assert.match(t, /\*\*state one specific, actionable career goal and confirm your profile\*\*/);
    assert.match(t, /repeats my wording/);
    const assessorWhy = heldReply(k, [2], { 2: 'the learner only restated the example' });
    assert.doesNotMatch(assessorWhy, /the learner|restated|repeats my wording/);
  });

  it('lists every objective still to show, addressed to the learner', () => {
    const t = heldReply(k, [2, 3], {});
    assert.match(t, /Still to show in your own words:\n- state one .* confirm your profile\n- explain why a value matters to you/);
    assert.equal(heldPosition(k, [3]), 'Close to the exemplar. Still to show in your own words: explain why a value matters to you in your own words.');
  });
});

describe('the coach’s polish of the learner’s own words (Blake, 2026-11-23)', () => {
  const own = 'I care about the qualty of my work, it has to be impactful and meaningful to comunities. Im iterative and detail driven';
  const polished = 'I care about the quality of my work. It has to be impactful and meaningful to communities. I’m iterative and detail-driven.';
  const verdict = (quote) => ({ objectives: [{ n: 1, shown: true, quote }] });

  it('counts a polished version of their own text as theirs, spelling slips included', () => {
    const transcript = [
      { by: 'learner', text: own },
      { by: 'coach', text: `Here’s your polished version: > ${polished} Send this exact version back.` },
      { by: 'learner', text: polished },
    ];
    assert.deepEqual(groundVerdict(verdict(polished), transcript, [1]).shown, [1]);
  });

  it('still holds a passage the coach wrote from scratch', () => {
    const drafted = 'My work is driven by a deep commitment to craft, and I bring curiosity and resilience to every team I join.';
    const transcript = [
      { by: 'learner', text: 'i like building stuff' },
      { by: 'coach', text: `Try this: "${drafted}"` },
      { by: 'learner', text: drafted },
    ];
    const g = groundVerdict(verdict(drafted), transcript, [1]);
    assert.deepEqual(g.shown, []);
    assert.equal(g.missing[1], COACH_WROTE);
  });

  it('spelling slips: one edit for shorter words, two for long ones, none under five letters', () => {
    assert.equal(closeSpelling('qualty', 'quality'), true);
    assert.equal(closeSpelling('comunities', 'communities'), true);
    assert.equal(closeSpelling('work', 'word'), false);
    assert.equal(closeSpelling('values', 'valley'), false);
    assert.equal(OWN_SHARE, 0.7);
  });
});
