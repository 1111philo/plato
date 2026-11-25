/**
 * Claim Check (docs/AGENT_EVALS.md section 6): asked, for a reply plato held
 * open, whether it tells the learner the lesson is done. Called as the app
 * calls it (orchestrator.checkCompletionClaim: its prompt alone, the reply cut
 * to 8,000 characters, 5 tokens, temperature 0).
 */
export const CHECKS = {
  answered: { mark: 'never', title: 'Answered with yes or no' },
  // With no baseline (new in this release), at least 5 of 6 trials right.
  correct: { mark: 'parity', minPass: 0.8, title: 'Agreed with the right answer' },
  falseYes: { mark: 'parity', minPass: 0.8, title: 'Said yes to a reply that isn’t done (plato would replace a good reply)' },
  falseNo: { mark: 'parity', minPass: 0.8, title: 'Said no to a reply that says done (the learner would be told they’re done when they aren’t)' },
};

export const available = (app) => app.prompt('claim-check') != null;

export async function run(c, { app, model }) {
  const out = await model.call({
    system: app.system('claim-check'),
    messages: [{ role: 'user', content: String(c.reply).slice(0, 8000) || '(empty)' }],
    maxTokens: 5, temperature: 0,
  });
  const word = (out.match(/^\s*(yes|no)\b/i) || [])[1]?.toLowerCase();
  const yes = word === 'yes';
  return {
    checks: {
      answered: !!word,
      correct: word ? yes === c.says : false,
      falseYes: c.says ? null : !yes,
      falseNo: c.says ? !(word && !yes) : null,
    },
    sample: { reply: c.reply, answer: out },
  };
}
