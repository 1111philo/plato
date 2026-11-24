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
  return { raw, ...parseResponse(raw) };
}

/** Why a written knowledge base can't be used, or null. */
export function kbProblem(markdown) {
  return !markdown || markdown.length < 50 ? 'Could not generate a knowledge base from the conversation. Keep adding information.' : null;
}

/**
 * Write the lesson or the knowledge base from the conversation (the extractor
 * agents).
 *
 * `check(markdown)` returns a problem (a sentence) or null. With `save`, a
 * result that passes the check is saved through it; without, the result is
 * only shown in the preview. Returns `{ markdown, problem }`.
 *
 * @param {object} o
 * @param {'lesson'|'knowledgeBase'} o.what
 * @param {string} o.conversationText buildConversationText(chatMessages)
 * @param {string} [o.existingKB]     the knowledge base being edited
 */
export async function authoringExtract({ what, conversationText, existingKB, check, save }) {
  const markdown = what === 'lesson'
    ? await orchestrator.extractLessonMarkdown(conversationText)
    : await orchestrator.extractKBMarkdown(conversationText, existingKB);
  const problem = check?.(markdown) || null;
  if (problem || !save) return { markdown, problem };
  await save(markdown);
  return { markdown, problem: null };
}
