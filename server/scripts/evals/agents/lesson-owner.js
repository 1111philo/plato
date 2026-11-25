/**
 * Lesson Owner (docs/AGENT_EVALS.md section 7): sets up a learner's copy of a
 * lesson. Input as orchestrator.initializeLessonKB builds it; the reply read
 * as it does and checked with the app's own validateLessonKB.
 */
import { LESSONS } from '../fixtures/lessons.js';
import { parseJSON, inLanguage, words } from '../lib/checks.js';

export const CHECKS = {
  readable: { mark: 'never', title: 'The setup is incomplete (plato’s own check refuses it)' },
  objectivesKept: { mark: 'never', title: 'Changed the author’s objectives (number or order)' },
  exemplarKept: { mark: 'never', title: 'Changed the exemplar' },
  startsAtZero: { mark: 'never', critical: true, title: 'Started the learner part-way' },
  numbersKept: { mark: 'never', title: 'Changed the author’s numbers' },
  doingWords: { mark: 'parity', minPass: 0.8, title: 'Evidence says what the learner produces' },
  short: { mark: 'parity', minPass: 0.8, title: 'Evidence is under 20 words' },
  fits: { mark: 'parity', minPass: 0.8, title: 'Evidence fits the lesson (a screenshot, a link)' },
  language: { mark: 'never', title: 'Wrote in the wrong language' },
};

export const available = (app) => app.prompt('lesson-owner') != null;

const KNOWS = /^\s*(understands?|knows?|is aware|appreciates|learns?)\b/i;

export async function run(c, { app, model }) {
  const lesson = LESSONS[c.lesson];
  const out = await model.call({
    system: app.system('lesson-owner', { language: c.language || '' }),
    messages: [{ role: 'user', content: JSON.stringify({
      lessonId: lesson.lessonId, lessonName: lesson.name, lessonDescription: lesson.description,
      exemplar: lesson.exemplar, learningObjectives: lesson.learningObjectives, learnerProfile: c.profile || 'New learner, no profile yet.',
      // As initializeLessonKB sends it, where this version does (orchestrator reads learnerLanguageName).
      ...(app.prompt('lesson-owner')?.includes('learnerLanguage') && app.languageFor(c.language || '') ? { learnerLanguage: app.languageFor(c.language) } : {}),
    }) }],
    maxTokens: 1536,
  });
  const kb = parseJSON(out);
  const invalid = kb ? app.validators.validateLessonKB?.(kb) : 'unreadable';
  if (!kb || invalid) return { checks: { readable: false }, sample: { reply: out, invalid } };
  const evidence = (kb.objectives || []).map((o) => String(o.evidence || ''));
  const numbers = (t) => (String(t).match(/\b\d+\b/g) || []).sort().join(',');
  return {
    checks: {
      readable: true,
      objectivesKept: (kb.objectives || []).length === lesson.learningObjectives.length,
      exemplarKept: c.language ? null : String(kb.exemplar || '').trim() === lesson.exemplar.trim(),
      startsAtZero: !kb.progress && !(kb.objectivesMet || []).length && (kb.activitiesCompleted || 0) === 0,
      numbersKept: c.language ? null : numbers(JSON.stringify(kb.objectives.map((o) => o.objective))) === numbers(JSON.stringify(lesson.learningObjectives)) && numbers(kb.exemplar) === numbers(lesson.exemplar),
      doingWords: evidence.every((e) => !KNOWS.test(e)),
      short: evidence.every((e) => words(e) < 20),
      fits: c.mustMention ? evidence.some((e) => new RegExp(c.mustMention, 'i').test(e)) : null,
      // What the learner reads ("Where you are"); `evidence` is for the Coach and Assessor only (ARCHITECTURE.md, learner language).
      language: c.language ? inLanguage(String(kb.learnerPosition || ''), c.language) : null,
    },
    sample: { evidence, learnerPosition: kb.learnerPosition },
  };
}
