/**
 * Course Progress Updater (docs/AGENT_EVALS.md section 10): one short unit
 * note after each completed lesson. Input as orchestrator.updateCourseProgress
 * builds it.
 */
import { parseJSON, inLanguage } from '../lib/checks.js';

export const CHECKS = {
  readable: { mark: 'never', title: 'The result couldn’t be used' },
  length: { mark: 'never', title: 'Over 600 characters' },
  notDone: { mark: 'never', critical: true, title: 'Claimed a lesson the learner hasn’t done' },
  noScore: { mark: 'never', title: 'Gave a score or said “complete”' },
  shown: { mark: 'parity', minPass: 0.8, title: 'Says what was shown' },
  language: { mark: 'never', title: 'Wrote in the wrong language' },
};

export const available = (app) => app.prompt('course-progress-update') != null;

export async function run(c, { app, model }) {
  const out = await model.call({
    system: app.system('course-progress-update', { language: c.language || '' }),
    messages: [{ role: 'user', content: JSON.stringify({ courseName: c.courseName || 'Foundations', lessonsInCourse: c.lessons, priorSummary: c.prior || '', completedLesson: c.completed, completedLessonIds: c.doneIds || [] }) }],
    maxTokens: 1024,
  });
  const r = parseJSON(out);
  if (typeof r?.summary !== 'string') return { checks: { readable: false }, sample: { reply: out } };
  const s = r.summary;
  const claims = (name) => new RegExp(`(completed|finished|demonstrated|wrote|built|submitted)[^.]{0,40}${name}|${name}[^.]{0,40}(completed|finished|done)`, 'i').test(s);
  return {
    checks: {
      readable: true,
      length: s.length <= 600,
      notDone: (c.notDone || []).every((n) => !claims(n)),
      noScore: !/\bprogress\s*\d|\b\d+\s*(\/|of|out of)\s*10\b|\bmastered\b/i.test(s),
      shown: c.want ? new RegExp(c.want, 'i').test(s) : null,
      language: c.language ? inLanguage(s, c.language) : null,
    },
    sample: { summary: s, chars: s.length },
  };
}
