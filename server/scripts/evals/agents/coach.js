/**
 * The Coach (docs/AGENT_EVALS.md section 4, single moments): one turn, run
 * through the version's own code as sendMessage runs it (lib/coachTurn.js).
 *   - the context from `buildContext`, the prompt as that version assembles it
 *   - one tag repair when tags are missing (`recoverMissingTags`)
 *   - the draft guard, where the version has it
 *   - the grading check with the Assessor and Claim Check, where it has it
 *     (#584); without it, as before (a 10 completes)
 *   - completion decided by `applyCoachResponseToKB`, the single owner
 *
 * Grew out of server/scripts/coach-eval.js's harness mode (#584).
 */
import { LESSONS, lessonKB } from '../fixtures/lessons.js';
import { coachTurn } from '../lib/coachTurn.js';
import { inLanguage, sentences, CJK, ESCALATED, CANT_TAKE, WORK, drafts } from '../lib/checks.js';

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

const SUSPICION = /\b(?:ai[- ]generated|chatgpt|copied|plagiar|not (?:their|the learner's) own|used ai)\b/i;
const EMPTY_PRAISE = /^\s*(?:great|awesome|amazing|fantastic|excellent|wonderful|perfect|love (?:it|this))\b[!.,]/i;

export async function run(c, { app, model }) {
  const { assessment } = app;
  const lesson = LESSONS[c.lesson];
  const kb = lessonKB(lesson, c.kb || {});
  const language = c.language || '';
  const turn = await coachTurn({
    app, model, lesson, kb, language, programKb: c.programKb || '', profile: c.profile || 'No profile yet', name: c.name ?? 'Sam', courseProgress: c.courseProgress || null,
    history: (c.history || []).map(([by, text]) => ({ role: by === 'L' ? 'user' : 'assistant', content: text })),
    message: c.message,
    links: c.links || [],
  });
  const { parsed, after, completed, newlyMet, text } = turn;
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
      drafted: expect.noDraft ? !drafts(text) : null,
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
