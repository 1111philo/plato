/**
 * The admin authoring chats: the lesson editor (lesson-creator) and the
 * knowledge base editor (Customizer, first-time setup). One place for what
 * each of them does around an AI call, so it is the same everywhere.
 *
 * No React. The pages drive these through hooks/useAuthoringChat.js.
 * Unit tests: client/tests/authoringEngine.test.js.
 */
import * as orchestrator from '../../js/orchestrator.js';
import { parseResponse, cleanStream } from './lessonCreationEngine.js';

// The agent is given the end of the conversation, not all of it.
export const AUTHORING_TAIL = 15;
const MAX_TOKENS = 512;

/** The messages an authoring agent is sent: the last AUTHORING_TAIL, role and text only. */
export function authoringTail(chatMessages) {
  return (chatMessages || []).slice(-AUTHORING_TAIL).map((m) => ({ role: m.role, content: m.content }));
}

/**
 * One turn of an authoring chat: send `messages` to `agent`, stream the reply
 * (without its readiness tag) to `onStream`, and return what plato's code
 * read from it: `{ raw, text, readiness }`.
 *
 */
export async function authoringTurn({ agent, messages, onStream }) {
  const raw = await orchestrator.converseStream(agent, messages, cleanStream(onStream), MAX_TOKENS, '');
  return recoverReadiness({ raw, ...parseResponse(raw) }, messages, (addendum, msgs) => orchestrator.converseStream(agent, msgs, () => {}, 20, addendum));
}

/** plato's message asking for the readiness line a reply left off. */
export const READINESS_CUE = 'plato: your last reply had no readiness line.';
export const READINESS_REPAIR_ADDENDUM = `## Readiness repair (from plato, not the user)

Your last reply ended without its readiness line. The final user message ("${READINESS_CUE}") comes from plato, not the user. Reply with ONLY the line for your last reply: [READINESS: N]. No other text.`;

/**
 * A turn whose reply left off its [READINESS: N] line (short replies often
 * did: agent evaluations D2, D3, K4, 2 to 3 of 6), with the score asked for
 * once: `ask(addendum, messages)` returns the agent's reply. Without it the
 * readiness meter, and the save button behind it, don't move. A failed or
 * unreadable answer leaves `readiness` null, as before.
 */
export async function recoverReadiness(turn, messages, ask) {
  if (turn.readiness != null) return turn;
  try {
    const raw = await ask(READINESS_REPAIR_ADDENDUM, [...messages, { role: 'assistant', content: turn.text || '…' }, { role: 'user', content: READINESS_CUE }]);
    const m = String(raw || '').match(/\[READINESS:\s*(\d+)\]/);
    if (m) return { ...turn, readiness: Math.min(10, parseInt(m[1], 10)), readinessRepaired: true };
  } catch { /* the meter stays where it was */ }
  return turn;
}

/** Why a written knowledge base can't be used, or null. */
export function kbProblem(markdown) {
  return !markdown || markdown.length < 50 ? 'Could not generate a knowledge base from the conversation. Keep adding information.' : null;
}

// A directive is the author's own words, verbatim (lesson-extractor.md), so
// most of its words are in what the author wrote. One that isn't was written
// by the extractor: coaching advice nobody asked for (agent evaluations X1,
// 1 in 12 after the prompt said never; 6 of 6 before).
const DIRECTIVE_OWN_SHARE = 0.5;
const contentWords = (t) => (String(t).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}./:-]*/gu) || []).map((w) => w.replace(/[.:]+$/, '')).filter((w) => w.length > 3);

/**
 * The lesson markdown without a `## Coach Directive` the author didn't give:
 * kept only when at least half its words are in the author's messages
 * (the "User:" lines of buildConversationText). Pure.
 */
export function withoutInventedDirective(markdown, conversationText) {
  const m = String(markdown || '').match(/^## Coach Directive[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!m) return markdown;
  const authored = new Set(String(conversationText || '').split(/\n\n/).filter((p) => /^User:/.test(p)).flatMap(contentWords));
  const words = contentWords(m[1]);
  const own = words.filter((w) => authored.has(w)).length;
  if (words.length && own / words.length >= DIRECTIVE_OWN_SHARE) return markdown;
  return markdown.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** How many times the extractor is asked before a check's problem is shown. */
export const EXTRACT_ATTEMPTS = 2;

/**
 * Write the lesson or the knowledge base from the conversation (the extractor
 * agents).
 *
 * `check(markdown)` returns a problem (a sentence) or null; a result it
 * refuses is written once more (EXTRACT_ATTEMPTS). With `save`, a
 * result that passes the check is saved through it; without, the result is
 * only shown in the preview. Returns `{ markdown, problem }`.
 *
 * @param {object} o
 * @param {'lesson'|'knowledgeBase'} o.what
 * @param {string} o.conversationText buildConversationText(chatMessages)
 * @param {string} [o.existingKB]     the knowledge base being edited
 */
export async function authoringExtract({ what, conversationText, existingKB, check, save }) {
  const extract = async () => (what === 'lesson'
    ? withoutInventedDirective(await orchestrator.extractLessonMarkdown(conversationText), conversationText)
    : orchestrator.extractKBMarkdown(conversationText, existingKB));
  let markdown = await extract();
  let problem = check?.(markdown) || null;
  // One more try when the check refuses it: the extractor occasionally slips
  // on a literal heading ("## Learning Objects", agent evaluations X3, 1 of 6),
  // and the author would otherwise see an error for the model's typo.
  for (let attempt = 1; problem && attempt < EXTRACT_ATTEMPTS; attempt++) {
    markdown = await extract();
    problem = check(markdown) || null;
  }
  if (problem || !save) return { markdown, problem };
  await save(markdown);
  return { markdown, problem: null };
}
