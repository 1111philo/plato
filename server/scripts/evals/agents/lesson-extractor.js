/**
 * Lesson Extractor (docs/AGENT_EVALS.md section 12): writes the lesson from
 * the design conversation. The conversation as lessonCreationEngine
 * buildConversationText writes it; the lesson checked with the server's own
 * validateLessonMarkdown (what saving it would check).
 */
import { inLanguage } from '../lib/checks.js';

export const CHECKS = {
  valid: { mark: 'never', title: 'The lesson can’t be saved (plato’s own check refuses it)' },
  objectives: { mark: 'never', title: 'Fewer than 2 or more than 4 objectives, or one not starting “Can”' },
  linkCode: { mark: 'never', title: 'Changed the author’s link or code' },
  noInvented: { mark: 'never', title: 'Added coach instructions nobody gave' },
  clean: { mark: 'never', title: 'Extra text around the lesson' },
  finalVersion: { mark: 'parity', minPass: 0.7, title: 'Used the final version' },
  produced: { mark: 'parity', minPass: 0.7, title: 'The exemplar describes something produced' },
  language: { mark: 'never', title: 'Wrote in the wrong language' },
};

export const available = (app) => app.prompt('lesson-extractor') != null && !!app.markdown?.validateLessonMarkdown;

export async function run(c, { app, model }) {
  const conversationText = app.creation?.buildConversationText
    ? app.creation.buildConversationText(c.convo.map(([by, text]) => ({ role: by === 'U' ? 'user' : 'assistant', content: text })))
    : c.convo.map(([by, t]) => `${by === 'U' ? 'User' : 'Lesson Creator'}: ${t}`).join('\n\n');
  const md = (await model.call({ system: app.system('lesson-extractor', { language: c.language || '' }), messages: [{ role: 'user', content: conversationText }], maxTokens: 1536 })).trim();
  const invalid = app.markdown.validateLessonMarkdown(md);
  const objectives = (md.match(/^- Can /gm) || []).length;
  const exemplar = (md.split(/^##\s*Exemplar\s*$/im)[1] || '').split(/^##\s/m)[0];
  return {
    checks: {
      valid: !invalid,
      objectives: objectives >= 2 && objectives <= 4,
      linkCode: c.contains ? c.contains.every((s) => md.includes(s)) : null,
      noInvented: c.noDirective ? !/^##\s*Coach Directive/im.test(md) : null,
      clean: md.startsWith('# '),
      finalVersion: c.final ? new RegExp(c.final, 'i').test(md) && !new RegExp(c.dropped, 'i').test(md) : null,
      produced: exemplar ? !/^\s*(the learner |learners )?(understands?|knows?)\b/i.test(exemplar.trim()) : null,
      language: c.language ? inLanguage(md.replace(/^#.*$/gm, ''), c.language) : null,
    },
    sample: { lesson: md.slice(0, 1500), invalid },
  };
}
