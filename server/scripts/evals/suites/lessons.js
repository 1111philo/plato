/**
 * Whole lessons (docs/AGENT_EVALS.md section 4, "Whole lessons"): a
 * simulated learner (lib/learner.js) plays a character card and the Coach
 * teaches the whole lesson, every turn through the app's own pipeline
 * (lib/coachTurn.js), the lesson record carried from turn to turn as the app
 * saves it. Run at the full level (a release).
 *
 * A case is one card across several lessons: each trial is one lesson
 * (`lessons[trial]`), so "at least as good as today" compares, say, twelve
 * Steady lessons with twelve.
 */
import { LESSONS, lessonKB } from '../fixtures/lessons.js';
import { STAGE_PROFILE, CARDS } from '../fixtures/learners.js';
import { LESSON_IMAGE, image } from '../fixtures/images.js';
import { coachTurn, coachOpening } from '../lib/coachTurn.js';
import { learnerReply } from '../lib/learner.js';
import { inLanguage, CANT_TAKE, WORK, drafts } from '../lib/checks.js';

export const CHECKS = {
  finishes: { mark: 'parity', minPass: 0.6, title: 'The learner finishes within the limit' },
  unearned: { mark: 'never', critical: true, title: 'Completed without the learner doing the work' },
  jumped: { mark: 'never', critical: true, title: 'The record says complete with objectives missing' },
  tags: { mark: 'never', title: 'A reply without the hidden score, even after plato asked again' },
  language: { mark: 'never', title: 'Switched out of the learner’s language' },
  workAssumed: { mark: 'never', title: 'Assumed work experience or a job search the learner didn’t mention' },
  cantTake: { mark: 'never', title: 'Asked for something plato can’t take (video, audio, a file, a terminal)' },
  drafted: { mark: 'parity', minPass: 0.7, title: 'The Coach wrote the learner’s work' },
  conversation: { mark: 'reading', title: 'The whole conversation (for the reading panel)' },
};

export const available = (app) => app.prompt('coach') != null && !!app.engine?.buildContext;

/** Did the learner's own words show every objective? Asked of the Assessor, as plato asks it, over the whole lesson. */
async function earned({ app, model, lesson, kb, history }) {
  const a = app.assessment;
  if (!a?.assessmentTranscript || !a.groundVerdict) return null;
  const transcript = a.assessmentTranscript([{ role: 'user', content: '{}' }, { role: 'assistant', content: 'Ready.' }, ...history]);
  const check = lesson.objectives.map((_, i) => i + 1);
  const ask = (note) => model.call({ system: app.system('assessor'), messages: [{ role: 'user', content: a.assessmentInput({ lesson, kb, transcript, check, ...(note ? { note } : {}) }) }], maxTokens: 2048, temperature: note ? 0.7 : 0 });
  // An unreadable reply is asked again, as checkGrading does; still unreadable is no verdict, not a failure.
  let raw = await ask();
  try { a.parseVerdict(raw); } catch { raw = await ask(a.FORMAT_NOTE || 'Reply with valid JSON only.'); }
  const judge = (r) => {
    try {
      // Grounded as checkGrading grounds it (a confirmation counts where the lesson says so).
      const g = a.groundVerdict(a.parseVerdict(r), transcript, check, a.confirmingCounts ? { confirms: a.confirmingCounts(kb) } : {});
      return { ok: g.shown.length === check.length, missing: g.missing };
    } catch { return null; }
  };
  const first = judge(raw);
  if (!first || first.ok) return first;
  // A refusal is asked once more (a single call can be wrong): unearned only if both refuse.
  const second = judge(await ask('Look again at each objective in the learner\'s own messages.'));
  return second && second.ok ? second : first;
}

export async function run(c, { app, model, trial = 0 }) {
  const lessonKey = c.lessons[trial % c.lessons.length];
  const stage = c.stages?.length ? c.stages[trial % c.stages.length] : null;
  const lesson = LESSONS[lessonKey];
  const language = CARDS[c.card].language || '';
  const profile = stage ? STAGE_PROFILE[stage] : 'No profile yet';
  const shot = LESSON_IMAGE[lessonKey];
  const limit = c.limit || 16;
  const common = { app, model, lesson, profile, language, name: 'Sam' };

  const opening = await coachOpening({ ...common, kb: lessonKB(lesson) });
  let kb = opening.after;
  const history = [{ role: 'assistant', content: opening.text }];
  const replies = [opening.text];
  let tagsOk = true;
  let jumped = false;
  let drafted = false;
  let completedAt = null;
  for (let i = 1; i <= limit && completedAt == null; i++) {
    const said = await learnerReply({ model, card: c.card, stage, lesson, canScreenshot: !!shot, history });
    const images = said.screenshot ? [image(shot)] : [];
    const turn = await coachTurn({ ...common, kb, history, message: said.text, images });
    // Stored as the app stores it: text only (the image is its own record).
    history.push({ role: 'user', content: said.text || (images.length ? '[image]' : '') }, { role: 'assistant', content: turn.text });
    replies.push(turn.text);
    if (turn.parsed.progress == null) tagsOk = false;
    if (drafts(turn.text, history.filter((m) => m.role === 'user').map((m) => String(m.content)))) drafted = true;
    kb = turn.after;
    const met = kb.objectivesMet;
    if (kb.status === 'completed' && Array.isArray(met) && app.work?.mergeObjectivesMet && met.length < lesson.objectives.length) jumped = true;
    if (turn.completed) completedAt = i;
  }
  const completed = completedAt != null;
  let unearned = null;
  let judged = null;
  if (c.noFinish && completed) judged = await earned({ app, model, lesson, kb, history });
  if (c.noFinish) unearned = completed ? (judged?.ok ?? null) : true;
  return {
    checks: {
      finishes: c.finish ? completed : null,
      unearned,
      jumped: !jumped,
      tags: tagsOk,
      language: language ? replies.every((t) => inLanguage(t, language)) : null,
      workAssumed: stage === 'firstYear' ? replies.every((t) => !WORK.test(t)) : null,
      cantTake: replies.every((t) => !CANT_TAKE.test(t)),
      drafted: !drafted,
      conversation: true,
    },
    sample: {
      ...(judged && !judged.ok ? { notShown: judged.missing } : {}),
      card: CARDS[c.card].name, lesson: `${lessonKey} ${lesson.name}`, stage, completed, exchanges: completedAt ?? limit, progress: kb.progress,
      conversation: history.map((m) => `${m.role === 'user' ? 'Learner' : 'Coach'}: ${m.content}`).join('\n\n'),
    },
  };
}
