/**
 * Lesson Creator (docs/AGENT_EVALS.md section 11): designs a lesson with a
 * member of the classroom team. Run as the lesson editor runs it (the
 * knowledge base and the full lesson list; 512 tokens), the readiness score
 * read with the app's own lessonCreationEngine.parseResponse.
 */
import { CATALOG } from '../fixtures/lessons.js';
import { inLanguage, sentences, questions } from '../lib/checks.js';
import { PROGRAM_KB } from '../fixtures/program.js';

export const CHECKS = {
  readiness: { mark: 'never', title: 'Readiness score missing or unreadable' },
  cantTake: { mark: 'never', title: 'Accepted something plato can’t take' },
  linkCode: { mark: 'never', critical: true, title: 'Changed the author’s link or code' },
  falseSave: { mark: 'never', title: 'Said something would be saved that won’t be' },
  language: { mark: 'never', title: 'Replied in the wrong language' },
  questions: { mark: 'parity', minPass: 0.7, title: 'More than one question' },
  long: { mark: 'parity', minPass: 0.7, title: 'Reply longer than 4 sentences' },
  ready: { mark: 'parity', minPass: 0.7, title: 'Readiness high when the design is complete' },
  overlap: { mark: 'parity', minPass: 0.7, title: 'Points to the overlapping lesson by name' },
  noFullLesson: { mark: 'parity', minPass: 0.7, title: 'Doesn’t write the whole lesson unprompted' },
  sizePushback: { mark: 'parity', minPass: 0.7, title: 'Pushes back on too many objectives or too big a lesson' },
};

/** A reply without its list items and "Label: value" lines. */
const prose = (t) => String(t).split('\n').filter((l) => !/^\s*([-*•]|\d+[.)])\s/.test(l) && !/^\s*\**[A-Z][\w -]{0,30}\**:\s*\S/.test(l)).join('\n');

export const available = (app) => app.prompt('lesson-creator') != null && !!app.creation?.parseResponse;

export async function run(c, { app, model }) {
  const raw = await model.call({
    system: app.system('lesson-creator', { kb: PROGRAM_KB, catalog: CATALOG, language: c.language || '' }),
    messages: c.convo.map(([by, text]) => ({ role: by === 'U' ? 'user' : 'assistant', content: text })),
    maxTokens: 512,
  });
  // As authoringTurn runs it: the readiness line asked for once when it's missing, where this version does.
  const messages = c.convo.map(([by, text]) => ({ role: by === 'U' ? 'user' : 'assistant', content: text }));
  const parsed = app.creation.parseResponse(raw);
  const { text, readiness } = app.authoring?.recoverReadiness
    ? await app.authoring.recoverReadiness(parsed, messages, (addendum, msgs) => model.call({ system: app.system('lesson-creator', { ...{ kb: PROGRAM_KB, catalog: CATALOG, language: c.language || '' }, addendum }), messages: msgs, maxTokens: 20 }))
    : parsed;
  return {
    checks: {
      readiness: readiness != null,
      cantTake: c.video ? /\b(can['’]?t|cannot|won['’]?t be able|unable|isn['’]?t able|not able|doesn['’]?t (support|accept)|isn['’]?t supported|not supported|not (a )?video|instead of (a )?video|only (accepts?|takes?|supports?) (text|images))\b/i.test(text) : null,
      // The author's link and code, if the reply repeats them, exactly as given.
      linkCode: c.contains ? (text.match(/https?:\/\/[^\s)>\]]+|\bPLATO-\w+/g) || []).every((s) => c.contains.some((k) => s.replace(/[.,;:]+$/, '') === k)) : null,
      falseSave: c.rubric ? !/rubric[^.]{0,40}\b(will be|is|gets?) saved|I(?:['’]ll| will) (?:save|store|keep) (?:the|your) rubric/i.test(text) : null,
      language: c.language ? inLanguage(text, c.language) : null,
      questions: questions(text) <= 1,
      // Prose only: D9 is expected to list the objectives (and the spec's
      // lesson structure is labelled lines), which aren't sentences of reply.
      long: sentences(prose(text)) <= 4,
      ready: c.complete ? (readiness ?? 0) >= 7 : null,
      overlap: c.overlap ? text.toLowerCase().includes(c.overlap.toLowerCase()) : null,
      noFullLesson: c.noLesson ? !/##\s*(learning objectives|exemplar)/i.test(raw) : null,
      sizePushback: c.tooBig ? /\b(2[–-]4|two to four|too (many|big|long)|split|smaller|focus on)\b/i.test(text) : null,
    },
    sample: { reply: text, readiness },
  };
}
