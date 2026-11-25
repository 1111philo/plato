/**
 * Knowledge Base Extractor (docs/AGENT_EVALS.md section 14): writes the
 * program description from the conversation, changing only what was
 * discussed. Input as orchestrator.extractKBMarkdown builds it.
 */
export const CHECKS = {
  clean: { mark: 'never', title: 'Extra text before the description' },
  kept: { mark: 'never', title: 'Dropped something the team didn’t ask to remove' },
  noInvented: { mark: 'never', critical: true, title: 'Invented a fact' },
  change: { mark: 'parity', minPass: 0.8, title: 'Made the change that was discussed' },
  short: { mark: 'parity', minPass: 0.8, title: 'Stays a short reference (not a copy of the chat)' },
};

export const available = (app) => app.prompt('knowledge-base-extractor') != null;

export async function run(c, { app, model }) {
  const conversation = c.convo.map(([by, t]) => `${by === 'U' ? 'User' : 'Knowledge Base Editor'}: ${t}`).join('\n\n');
  const content = `## EXISTING KNOWLEDGE BASE\n\n${c.existing || '(none — creating from scratch)'}\n\n## CONVERSATION\n\n${conversation}`;
  const md = (await model.call({ system: app.system('knowledge-base-extractor'), messages: [{ role: 'user', content }], maxTokens: 4096 })).trim();
  return {
    checks: {
      clean: md.startsWith('#'),
      kept: (c.keep || []).every((k) => md.includes(k)),
      noInvented: c.unknown ? !new RegExp(c.unknown, 'i').test(md) : null,
      change: c.want ? new RegExp(c.want, 'i').test(md) && (!c.gone || !new RegExp(c.gone, 'i').test(md)) : null,
      short: md.length < Math.max(3000, (c.existing || '').length * 1.6),
    },
    sample: { kb: md.slice(0, 1500) },
  };
}
