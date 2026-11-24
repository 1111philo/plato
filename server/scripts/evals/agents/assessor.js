/**
 * The Assessor (docs/AGENT_EVALS.md section 5): for each objective the Coach
 * wants to check off, it must find the learner's own words. Run as plato runs
 * it: the conversation through `assessmentTranscript`, its input through
 * `assessmentInput`, the reply through `parseVerdict` (once more with
 * FORMAT_NOTE if unreadable, as checkGrading does), and every quote through
 * `groundVerdict`, plato's own check that the quote is the learner's.
 */
import { LESSONS, lessonKB } from '../fixtures/lessons.js';

export const CHECKS = {
  readable: { mark: 'never', title: 'Gave an answer plato could read' },
  // minPass: with no baseline (new in this release), at least this share of trials.
  falseShown: { mark: 'parity', minPass: 0.8, title: 'Called an objective shown that wasn’t' },
  missed: { mark: 'parity', minPass: 0.6, title: 'Refused an objective that was shown' },
  correct: { mark: 'parity', minPass: 0.6, title: 'Agreed with the right answer on every objective' },
};

export const available = (app) => app.prompt('assessor') != null && !!app.assessment?.groundVerdict;

const toMessages = (convo) => convo.map(([by, text]) => ({ role: by === 'L' ? 'user' : 'assistant', content: text }));

export async function run(c, { app, model }) {
  const lesson = LESSONS[c.lesson];
  const kb = lessonKB(lesson);
  const messages = [{ role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' }, ...toMessages(c.convo)];
  const { assessmentTranscript, assessmentInput, parseVerdict, groundVerdict, FORMAT_NOTE } = app.assessment;
  const transcript = assessmentTranscript(messages);
  const ask = (note) => model.call({
    system: app.system('assessor'),
    messages: [{ role: 'user', content: assessmentInput({ lesson, kb, transcript, check: c.check, ...(note ? { note } : {}) }) }],
    maxTokens: 2048, temperature: 0,
  });
  let raw = await ask();
  let verdict = null;
  try { verdict = parseVerdict(raw); } catch {
    raw = await ask(FORMAT_NOTE);
    try { verdict = parseVerdict(raw); } catch { /* unreadable twice */ }
  }
  if (!verdict) return { checks: { readable: false, falseShown: null, missed: null, correct: false }, sample: { raw } };
  const { shown } = groundVerdict(verdict, transcript, c.check);
  const want = new Set(c.shown);
  const got = new Set(shown);
  const falseShown = c.check.filter((n) => got.has(n) && !want.has(n));
  const missed = c.check.filter((n) => want.has(n) && !got.has(n));
  return {
    checks: {
      readable: true,
      falseShown: c.check.some((n) => !want.has(n)) ? falseShown.length === 0 : null,
      missed: c.shown.length ? missed.length === 0 : null,
      correct: falseShown.length === 0 && missed.length === 0,
    },
    sample: { shown, expected: c.shown, raw },
  };
}
