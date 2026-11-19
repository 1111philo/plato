/**
 * An agent's system prompt from its parts. Pure, so the app
 * (orchestrator.buildSystemPrompt) and the coach eval
 * (server/scripts/coach-eval.js) build the same text. Unit tests:
 * client/tests/promptAssembly.test.js.
 *
 * Order: the prompt file, the program knowledge base, the lesson catalog, the
 * part of the prompt file after AFTER_CONTEXT_MARKER, the addendum, then the
 * language directive.
 *
 * Why the marker and the note (#584): the knowledge base and lesson list were
 * the last thing the coach read, after ~21 KB of rules. A classroom's
 * knowledge base describes the whole program (AI Leaders': "the core is
 * building your professional identity and portfolio"), and the coach drifted
 * to that and stopped holding learners to the lesson in front of them. The
 * note says what the knowledge base is for; the rules after the marker are the
 * last thing the model reads.
 */

export const AFTER_CONTEXT_MARKER = '<!-- AFTER CONTEXT -->';

/** What the coach is told the knowledge base is (and isn't) for. */
export const COACH_KB_NOTE = 'Background on the program, for answering questions about it. It does not set this lesson\'s focus: coach toward this lesson\'s exemplar and objectives. Bring up program-wide goals (for example, a portfolio) only when this lesson\'s objectives or coach directive ask for them.';

/** Split a prompt file at the marker into the part before the context and the part after. */
export function splitAtMarker(prompt) {
  const text = String(prompt ?? '');
  const i = text.indexOf(AFTER_CONTEXT_MARKER);
  if (i === -1) return { before: text, after: '' };
  return { before: text.slice(0, i).trimEnd(), after: text.slice(i + AFTER_CONTEXT_MARKER.length).trim() };
}

/**
 * @param {object} p
 * @param {string} p.prompt - the agent's prompt file
 * @param {string} [p.kb] - program knowledge base
 * @param {string} [p.kbNote] - a line saying what the KB is for (the coach's: COACH_KB_NOTE)
 * @param {string} [p.catalog] - lesson list
 * @param {string} [p.catalogHeading]
 * @param {string} [p.addendum] - a one-turn instruction from plato (tag repair, a held completion)
 * @param {string} [p.languageDirective] - from language.js; '' for English
 */
export function assembleSystemPrompt({ prompt, kb = '', kbNote = '', catalog = '', catalogHeading = 'Lessons in This Classroom', addendum = '', languageDirective = '' }) {
  const { before, after } = splitAtMarker(prompt);
  let out = before;
  if (kb) out += `\n\n---\n\n## Program Knowledge Base${kbNote ? '\n\n' + kbNote : ''}\n\n${kb}`;
  if (catalog) out += `\n\n---\n\n## ${catalogHeading}\n\n${catalog}`;
  if (after) out += `\n\n---\n\n${after}`;
  if (addendum) out += `\n\n---\n\n${addendum}`;
  return out + (languageDirective || '');
}
