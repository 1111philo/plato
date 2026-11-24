/**
 * An agent's system prompt from its parts. Pure, so the app
 * (orchestrator.agentParts) and the coach eval
 * (server/scripts/coach-eval.js) build the same text. Unit tests:
 * client/tests/promptAssembly.test.js.
 *
 * Order: the prompt file, the program knowledge base, the lesson catalog, the
 * part of the prompt file after AFTER_CONTEXT_MARKER, the addendum, then the
 * language directive. The prompt file's header comment (js/agentHeader.js) is
 * taken off first: it documents the agent and is never sent. Sent, it changed
 * the coach's grading: in an eval, with the header the coach completed a
 * lesson on thin answers 7 times in 20; without it, 0 (2026-11-24).
 *
 * Why the marker and the note (#584): the knowledge base and lesson list were
 * the last thing the coach read, after ~21 KB of rules. A classroom's
 * knowledge base describes the whole program (AI Leaders': "the core is
 * building your professional identity and portfolio"), and the coach drifted
 * to that and stopped holding learners to the lesson in front of them. The
 * note says what the knowledge base is for; the rules after the marker are the
 * last thing the model reads.
 */

import { parseAgentHeader } from './agentHeader.js';

export const AFTER_CONTEXT_MARKER = '<!-- AFTER CONTEXT -->';

const HEADER = /^\s*<!--[\s\S]*?-->\s*/;

/** A prompt file as `{ header, body }`: its parsed header (or null) and the text without it. */
export function splitHeader(prompt) {
  const text = String(prompt ?? '');
  const header = parseAgentHeader(text);
  return header ? { header, body: text.replace(HEADER, '') } : { header: null, body: text };
}

/**
 * The message plato sends, as the learner's turn, when it asks the coach for
 * the tags of a reply that came without them (orchestrator.repairCoachTags).
 * Here so the Trace can say who wrote it.
 */
export const TAG_REPAIR_CUE = 'Tags for your last reply.';

/** What plato puts in the coach's turn after its first message, as if the model had said it. */
export const READY = 'Ready.';

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
export function assembleSystemPrompt(p) {
  return systemPromptParts(p).map((part) => part.text).join('');
}

/**
 * The same prompt as its parts, in order: `[{ kind, text, header? }]`, where
 * the texts joined are exactly the prompt sent (each part carries its own separator and
 * heading). Trace mode stores and shows the parts, so a person can see which
 * instructions came from the prompt file, the classroom's knowledge base, the
 * lesson list, a one-turn addition from plato, or the language directive.
 */
export function systemPromptParts({ prompt, kb = '', kbNote = '', catalog = '', catalogHeading = 'Lessons in This Classroom', addendum = '', languageDirective = '' }) {
  const { header, body } = splitHeader(prompt);
  const { before, after } = splitAtMarker(body);
  // `header` is carried beside the text for the Trace; only `text` is sent.
  const parts = [{ kind: 'prompt', text: before, ...(header ? { header } : {}) }];
  if (kb) parts.push({ kind: 'knowledgeBase', text: `\n\n---\n\n## Program Knowledge Base${kbNote ? '\n\n' + kbNote : ''}\n\n${kb}` });
  if (catalog) parts.push({ kind: 'catalog', text: `\n\n---\n\n## ${catalogHeading}\n\n${catalog}` });
  if (after) parts.push({ kind: 'promptAfter', text: `\n\n---\n\n${after}` });
  if (addendum) parts.push({ kind: 'addendum', text: `\n\n---\n\n${addendum}` });
  if (languageDirective) parts.push({ kind: 'language', text: languageDirective });
  return parts;
}
