/**
 * Knowledge Base Editor (docs/AGENT_EVALS.md section 13): describes the
 * program by conversation. Run as the Customizer runs it; the readiness
 * score read with lessonCreationEngine.parseResponse.
 */
import { inLanguage, sentences, questions } from '../lib/checks.js';

export const CHECKS = {
  readiness: { mark: 'never', title: 'Readiness score missing or unreadable' },
  notReady: { mark: 'never', title: 'Said “ready to save” without the three essentials' },
  noInvented: { mark: 'never', critical: true, title: 'Invented a fact' },
  noSelfEdit: { mark: 'never', title: 'Told the team to edit it themselves' },
  language: { mark: 'never', title: 'Replied in the wrong language' },
  ready: { mark: 'parity', minPass: 0.7, title: 'Readiness reaches “can save” with the three essentials' },
  questions: { mark: 'parity', minPass: 0.7, title: 'More than one question' },
  long: { mark: 'parity', minPass: 0.7, title: 'Reply longer than 4 sentences' },
};

export const available = (app) => app.prompt('knowledge-base-editor') != null && !!app.creation?.parseResponse;

// What "can save" means: the prompt locks the save button until readiness 3.
const CAN_SAVE = 3;

export async function run(c, { app, model }) {
  const raw = await model.call({
    system: app.system('knowledge-base-editor', { kb: c.existing || '', language: c.language || '' }),
    messages: c.convo.map(([by, text]) => ({ role: by === 'U' ? 'user' : 'assistant', content: text })),
    maxTokens: 512,
  });
  // As authoringTurn runs it: the readiness line asked for once when it's missing, where this version does.
  const messages = c.convo.map(([by, text]) => ({ role: by === 'U' ? 'user' : 'assistant', content: text }));
  const parsed = app.creation.parseResponse(raw);
  const { text, readiness } = app.authoring?.recoverReadiness
    ? await app.authoring.recoverReadiness(parsed, messages, (addendum, msgs) => model.call({ system: app.system('knowledge-base-editor', { ...{ kb: c.existing || '', language: c.language || '' }, addendum }), messages: msgs, maxTokens: 20 }))
    : parsed;
  return {
    checks: {
      readiness: readiness != null,
      notReady: c.missingEssentials ? (readiness ?? 0) < CAN_SAVE : null,
      // A quoted example of what the team might say ("e.g., 'next cohort begins in June'") isn't a claim.
      noInvented: c.unknown ? !new RegExp(c.unknown, 'i').test(text.replace(/["“‘][^"”’]*["”’]/g, '')) : null,
      noSelfEdit: c.selfEdit ? !/\b(you can|feel free to|just) (edit|change|update) (it|the text|the knowledge base) (yourself|directly)\b/i.test(text) : null,
      language: c.language ? inLanguage(text, c.language) : null,
      ready: c.essentials ? (readiness ?? 0) >= CAN_SAVE : null,
      questions: questions(text) <= 1,
      long: sentences(text) <= 4,
    },
    sample: { reply: text, readiness },
  };
}
