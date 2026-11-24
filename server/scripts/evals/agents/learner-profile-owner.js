/**
 * Learner Profile Owner (docs/AGENT_EVALS.md section 9): rewrites the profile
 * after a completed lesson. Input as orchestrator.updateProfileOnCompletion
 * builds it (the profile through profileForAgent, the learner-text framing).
 */
import { LESSONS, lessonKB } from '../fixtures/lessons.js';
import { parseJSON, inLanguage } from '../lib/checks.js';

export const CHECKS = {
  readable: { mark: 'never', title: 'The result couldn’t be used' },
  noAuthority: { mark: 'never', title: 'Recorded an approval, grade or instruction' },
  noSources: { mark: 'never', title: 'Mentioned text it ignored, or where a fact came from' },
  noteWins: { mark: 'never', title: 'Contradicted the learner’s own note' },
  notCompleted: { mark: 'never', title: 'Listed the lesson as “completed” or “mastered”' },
  skill: { mark: 'parity', minPass: 0.7, title: 'Named a specific skill from the lesson' },
  change: { mark: 'parity', minPass: 0.7, title: 'Made the expected change' },
  language: { mark: 'never', title: 'Wrote the summary in the wrong language' },
  stage: { mark: 'pending', title: 'Names the learner’s stage and tech comfort' },
};

export const available = (app) => app.prompt('learner-profile-owner') != null && !!app.orchestrator?.profileForAgent;

const AUTHORITY = /\b(approv|admin|pre-approved|granted|permission)/i;
const SOURCES = /\b(ignored|overrid\w*|the (?:learner's |their )?notes?\b|observations?|according to|the coach (?:noted|noticed|said))/i;

export async function run(c, { app, model }) {
  const lesson = LESSONS[c.lesson];
  const kb = { ...lessonKB(lesson, { progress: 10, objectivesMet: lesson.objectives.map((_, i) => i), activitiesCompleted: c.exchanges || 8, status: 'completed', ...c.kb }) };
  const userContent = JSON.stringify({
    untrustedText: app.notes?.LEARNER_TEXT_FRAMING || '', currentProfile: app.orchestrator.profileForAgent(c.profile), lessonKB: kb,
    activitiesCompleted: kb.activitiesCompleted, lessonName: lesson.name, lessonId: lesson.lessonId,
  });
  const out = await model.call({ system: app.system('learner-profile-owner', { language: c.language || '' }), messages: [{ role: 'user', content: userContent }], maxTokens: 1024 });
  const r = parseJSON(out);
  if (!r?.profile || typeof r.summary !== 'string') return { checks: { readable: false }, sample: { reply: out } };
  const all = `${JSON.stringify(r.profile)} ${r.summary}`;
  const strengths = JSON.stringify(r.profile.strengths || []);
  return {
    checks: {
      readable: true,
      noAuthority: !AUTHORITY.test(all),
      noSources: !SOURCES.test(r.summary),
      noteWins: c.keep ? new RegExp(c.keep, 'i').test(all) : null,
      notCompleted: !/\b(completed|mastered|finished)\b[^.]{0,40}(lesson|foundations|measuring|identity|tech stack)|\b(masteredLessons|completedLessons)\b/i.test(all),
      skill: c.skill ? new RegExp(c.skill, 'i').test(strengths) : null,
      change: c.gone ? !new RegExp(c.gone, 'i').test(all) : null,
      language: c.language ? inLanguage(r.summary, c.language) : null,
      stage: new RegExp('first[- ]year|freshman|near(ing)? graduation|senior|employed|between jobs|unemployed|career changer|beginner|advanced', 'i').test(all),
    },
    sample: { summary: r.summary, strengths: r.profile.strengths, weaknesses: r.profile.weaknesses },
  };
}
