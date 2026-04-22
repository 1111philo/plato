/**
 * Lesson creation engine helpers used by the Lesson Creator, Customizer, and
 * KB Setup chat views. The actual creation flow lives inline in each view's
 * NewLessonView/equivalent — this file only exports shared parsing utilities.
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
