/**
 * Parsing helpers shared by the authoring chats (lesson editor, Customizer, KB
 * setup). The flow itself is hooks/useAuthoringChat.js + lib/authoringEngine.js.
 */

const READINESS_REGEX = /\[READINESS:\s*(\d+)\]\s*$/;

/** Strip the readiness tag from a response and return { text, readiness }. */
export function parseResponse(raw) {
  const match = raw.match(READINESS_REGEX);
  const readiness = match ? parseInt(match[1], 10) : null;
  const text = stripReadiness(raw);
  return { text, readiness };
}

/** Strip any readiness tag from text. */
function stripReadiness(text) {
  return text.replace(READINESS_REGEX, '').trim();
}

/** Wrap a stream callback to strip the readiness tag from partial text. */
export function cleanStream(onStream) {
  if (!onStream) return () => {};
  return (partial) => onStream(stripReadiness(partial));
}

/**
 * Rebuild a chat-message array into the "User: …\n\nAgent: …" text the
 * lesson-extractor agent expects. Shared by the lesson editor's finalize
 * ("Create/Update Lesson") and preview-refresh paths so both feed the
 * extractor the exact same input.
 */
export function buildConversationText(chatMessages) {
  return (chatMessages || [])
    .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n\n');
}
