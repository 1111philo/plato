/**
 * The admin authoring chats: the lesson editor (lesson-creator) and the
 * knowledge base editor (Customizer, first-time setup). One place for what
 * each of them does around an AI call, so it is the same everywhere and can
 * be recorded by Trace mode (#595, docs/ARCHITECTURE.md "Beyond lessons").
 *
 * With Trace mode off, `openTrace` gives undefined and every request is
 * exactly what it was before this file existed: nothing is recorded or added.
 *
 * No React. The pages drive these through hooks/useAuthoringChat.js.
 * Unit tests: client/tests/trace-authoring.test.js.
 */
import * as orchestrator from '../../js/orchestrator.js';
import { parseResponse, cleanStream } from './lessonCreationEngine.js';
import { openTrace } from './traceSession.js';

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
 * `text` is what the admin wrote this turn; leave it out for the opening
 * call, where plato sends a fixed first message itself. `scope` is the Trace
 * scope (`kb`, or `author-<lessonId>`).
 */
export async function authoringTurn({ scope, agent, messages, text, total = messages.length, readinessBefore = null, onStream }) {
  const trace = await openTrace(scope, 'authoring');
  try {
    if (text != null) trace?.step('authorInput', { text });
    else trace?.step('authoringOpened', { opening: messages.at(-1)?.content ?? '', resumed: messages.length > 1 });
    trace?.step('authoringTail', { sent: messages.length, olderLeftOut: Math.max(0, total - messages.length) });
    const raw = await orchestrator.converseStream(
      agent, messages, cleanStream(onStream), MAX_TOKENS, '',
      trace ? { trace, purpose: text != null ? 'reply' : 'opening message' } : undefined,
    );
    const parsed = parseResponse(raw);
    trace?.step('authoringParsed', { raw, text: parsed.text, readiness: parsed.readiness, readinessBefore });
    return { raw, ...parsed };
  } catch (e) {
    trace?.fail(e);
    throw e;
  } finally {
    trace?.flush();
  }
}

/** Why a written knowledge base can't be used, or null. */
export function kbProblem(markdown) {
  return !markdown || markdown.length < 50 ? 'Could not generate a knowledge base from the conversation. Keep adding information.' : null;
}

/**
 * Write the lesson or the knowledge base from the conversation (the extractor
 * agents), as its own Trace turn.
 *
 * `check(markdown)` returns a problem (a sentence) or null. With `save`, a
 * result that passes the check is saved through it; without, the result is
 * only shown in the preview. Returns `{ markdown, problem }`.
 *
 * @param {object} o
 * @param {string} o.scope            Trace scope
 * @param {'lesson'|'knowledgeBase'} o.what
 * @param {string} o.conversationText buildConversationText(chatMessages)
 * @param {string} [o.existingKB]     the knowledge base being edited
 * @param {number} [o.messages]       how many chat messages the text was built from
 */
export async function authoringExtract({ scope, what, conversationText, existingKB, messages = null, check, save }) {
  const trace = await openTrace(scope, 'authoring');
  try {
    trace?.step('extractAsked', { what, why: save ? 'save' : 'preview', messages });
    const opts = trace ? { trace } : undefined;
    const markdown = what === 'lesson'
      ? await orchestrator.extractLessonMarkdown(conversationText, opts)
      : await orchestrator.extractKBMarkdown(conversationText, existingKB, opts);
    const problem = check?.(markdown) || null;
    trace?.step('extracted', { what, markdown, problem, use: problem ? 'none' : save ? 'save' : 'preview' });
    if (problem || !save) return { markdown, problem };
    try {
      await save(markdown);
      trace?.step('authoringSaved', { what, ok: true });
    } catch (e) {
      trace?.step('authoringSaved', { what, ok: false, why: String(e?.message || e).slice(0, 300) });
      throw e;
    }
    return { markdown, problem: null };
  } catch (e) {
    trace?.fail(e);
    throw e;
  } finally {
    trace?.flush();
  }
}
