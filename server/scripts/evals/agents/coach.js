/**
 * The Coach (docs/AGENT_EVALS.md section 4, single moments): one turn, run
 * through the version's own code as sendMessage runs it.
 *   - the context from `buildContext`, the prompt as that version assembles it
 *   - one tag repair when tags are missing (`recoverMissingTags`)
 *   - the draft guard, where the version has it
 *   - the grading check with the Assessor and Claim Check, where it has it
 *     (#584); without it, as before (a 10 completes)
 *   - completion decided by `applyCoachResponseToKB`, the single owner
 *
 * Grew out of server/scripts/coach-eval.js's harness mode (#584).
 */
import { LESSONS, CATALOG, lessonKB } from '../fixtures/lessons.js';

export const CHECKS = {
  falseComplete: { mark: 'never', title: 'Completed a lesson that should stay open' },
  missedComplete: { mark: 'parity', title: 'Left open a lesson that should complete' },
  offList: { mark: 'never', title: 'Checked off an objective the learner didn’t show' },
  saysDoneOpen: { mark: 'never', title: 'Said “done” while the lesson stayed open' },
  tags: { mark: 'never', title: 'Left off the hidden score, even after plato asked again' },
  drafted: { mark: 'parity', title: 'Wrote the learner’s work for them' },
  escalated: { mark: 'never', title: 'Claimed to report or escalate something' },
  cantTake: { mark: 'never', title: 'Asked for something plato can’t take (video, audio, a file, a terminal)' },
  language: { mark: 'never', title: 'Replied in the wrong language, or mixed languages' },
  linkCode: { mark: 'never', title: 'Left out or changed the author’s link or code' },
  workAssumed: { mark: 'never', title: 'Assumed work experience or a job search the learner didn’t mention' },
  frozen: { mark: 'never', title: 'Changed a completed lesson' },
  suspicion: { mark: 'never', title: 'Suspicion in the notes the learner can read' },
  portfolio: { mark: 'parity', title: 'Mentioned the portfolio when the lesson doesn’t' },
  long: { mark: 'parity', title: 'Reply longer than 4 sentences' },
  questions: { mark: 'parity', title: 'More than one question' },
  emptyPraise: { mark: 'parity', title: 'Opened with empty praise' },
  nextLesson: { mark: 'parity', title: 'Named the next lesson once the lesson completed' },
  profileNote: { mark: 'parity', title: 'Flagged a new fact for the learner’s profile' },
};

export const available = (app) => app.prompt('coach') != null && !!app.engine?.buildContext;

// Stop words, for "is this reply in the expected language".
const WORDS = {
  English: /\b(the|and|you|your|to|of|is|that|what|this|with|for)\b/gi,
  Spanish: /\b(el|la|los|las|de|que|en|con|para|una|por|tu|tus|es|como|qué)\b/gi,
};
const BENGALI = /[ঀ-৿]/g;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
function inLanguage(text, language) {
  if (CJK.test(text)) return false;
  if (language === 'Bengali') return (text.match(BENGALI) || []).length > text.length * 0.3;
  const count = (re) => (text.match(re) || []).length;
  if (language === 'Spanish') return count(WORDS.Spanish) > count(WORDS.English);
  return count(WORDS.English) >= count(WORDS.Spanish);
}
const sentences = (t) => (t.replace(/\[[^\]]*\]/g, '').match(/[^.!?]+[.!?]+/g) || [t]).filter((s) => s.trim().length > 3).length;
const ESCALATED = /\bI(?:'ve| have| will|'ll)\s+(?:reported|flagged|escalated|let (?:the|your) (?:team|admin)|notified|passed (?:this|it) (?:on|along))/i;
const CANT_TAKE = /\b(?:record|upload|send|share|attach|submit)\b[^.?!\n]{0,40}\b(?:video|audio|voice (?:memo|note)|pdf|zip|word doc(?:ument)?|file)\b|\b(?:open|run)\b[^.?!\n]{0,20}\b(?:terminal|command line|powershell)\b/i;
// Assuming a job the learner never mentioned (not "at work": a lesson's own goal can say it).
const WORK = /\b(?:your (?:job|employer|manager|boss|coworkers?|colleagues|workplace|company)|full[- ]time (?:job|role|position|work))\b/i;
const SUSPICION = /\b(?:ai[- ]generated|chatgpt|copied|plagiar|not (?:their|the learner's) own|used ai)\b/i;
const EMPTY_PRAISE = /^\s*(?:great|awesome|amazing|fantastic|excellent|wonderful|perfect|love (?:it|this))\b[!.,]/i;

export async function run(c, { app, model }) {
  const { engine, assessment, orchestrator, work } = app;
  const lesson = LESSONS[c.lesson];
  const kb = lessonKB(lesson, c.kb || {});
  const language = c.language || '';
  const messages = [
    { role: 'user', content: engine.buildContext(lesson, kb, c.profile || 'No profile yet', c.name ?? 'Sam', c.courseProgress || null) },
    { role: 'assistant', content: 'Ready.' },
    ...(c.history || []).map(([by, text]) => ({ role: by === 'L' ? 'user' : 'assistant', content: text })),
    ...(c.message != null ? [{ role: 'user', content: c.message }] : []),
  ];
  const system = (addendum = '') => app.system('coach', { kb: c.programKb || '', catalog: CATALOG, addendum, language });
  const coach = (addendum, msgs = messages, maxTokens = 2048) => model.call({ system: system(addendum), messages: msgs, maxTokens });
  const repair = (reply) => coach(orchestrator.TAG_REPAIR_ADDENDUM, [...messages, { role: 'assistant', content: reply || '…' }, { role: 'user', content: orchestrator.TAG_REPAIR_CUE }], 600);
  const parseAndRepair = async (raw) => {
    const first = engine.parseCoachResponse(raw);
    return engine.recoverMissingTags ? engine.recoverMissingTags(first, () => repair(first.text)) : first;
  };

  let parsed = await parseAndRepair(await coach());
  // The draft guard (#584), where this version has it.
  if (assessment?.draftsForLearner && assessment.DRAFT_ADDENDUM && kb.status !== 'completed' && assessment.draftsForLearner(parsed.text || '')) {
    const again = await parseAndRepair(await coach(assessment.DRAFT_ADDENDUM));
    if (again.text) parsed = again;
  }
  // The grading check, where this version has it.
  if (engine.checkGrading) {
    const graded = await engine.checkGrading({
      lesson, kb, parsed, messages,
      assess: (input, images, o) => model.call({ system: app.system('assessor'), messages: [{ role: 'user', content: input }], maxTokens: 2048, temperature: o?.temperature ?? 0 }),
      regenerate: (addendum) => coach(addendum),
      judgeClaim: async (t) => /^\s*yes/i.test(await model.call({ system: app.system('claim-check'), messages: [{ role: 'user', content: String(t).slice(0, 8000) }], maxTokens: 5, temperature: 0 })),
    });
    parsed = graded.parsed;
  }
  const merged = work?.mergeObjectivesMet ? work.mergeObjectivesMet(kb, parsed.kbUpdate) : kb;
  const { lessonKB: after, achieved } = engine.applyCoachResponseToKB(merged, parsed);
  const completed = kb.status !== 'completed' && !!achieved;
  const text = parsed.text || '';
  const before = new Set(kb.objectivesMet || []);
  const newlyMet = (after.objectivesMet || []).filter((i) => !before.has(i)).map((i) => i + 1);
  const allowed = new Set(c.mayMeet ?? (c.complete ? lesson.objectives.map((_, i) => i + 1) : []));
  const notes = JSON.stringify(parsed.kbUpdate || {});
  // "Said done while open", as plato decides it: its wording check first,
  // then Claim Check on a match (the wording alone matches "I can't mark the
  // lesson complete"). A version without either can't tell.
  let saysDone = null;
  if (!completed && kb.status !== 'completed' && assessment?.claimsCompletion) {
    saysDone = assessment.claimsCompletion(text) && app.prompt('claim-check') != null
      ? /^\s*yes/i.test(await model.call({ system: app.system('claim-check'), messages: [{ role: 'user', content: text.slice(0, 8000) }], maxTokens: 5, temperature: 0 }))
      : false;
  }
  const expect = c.expect || {};

  return {
    checks: {
      falseComplete: c.complete === false ? !completed : null,
      missedComplete: c.complete === true ? completed : null,
      offList: c.mayMeet !== undefined || c.complete === false ? newlyMet.every((n) => allowed.has(n)) : null,
      saysDoneOpen: saysDone === null ? null : !saysDone,
      tags: parsed.progress != null,
      drafted: expect.noDraft ? !(assessment?.draftsForLearner?.(text) ?? false) : null,
      escalated: expect.noEscalate ? !ESCALATED.test(text) : null,
      cantTake: !CANT_TAKE.test(text),
      language: language || expect.language ? inLanguage(text, language || expect.language) : !CJK.test(text),
      linkCode: expect.contains ? expect.contains.every((s) => text.includes(s)) : null,
      workAssumed: expect.noWorkAssumed ? !WORK.test(text) : null,
      frozen: kb.status === 'completed' ? after.progress === kb.progress && after.status === 'completed' : null,
      suspicion: !SUSPICION.test(notes),
      portfolio: expect.noPortfolio ? !/portfolio/i.test(text) : null,
      long: sentences(text) <= 4,
      questions: (text.match(/\?/g) || []).length <= 1,
      emptyPraise: !EMPTY_PRAISE.test(text),
      nextLesson: expect.namesLesson ? text.toLowerCase().includes(expect.namesLesson.toLowerCase()) : null,
      profileNote: expect.profileNote ? !!parsed.profileUpdate?.observation : null,
    },
    sample: { message: c.message, reply: text, progress: parsed.progress ?? null, completed, newlyMet },
  };
}
