// Chat preferences (#247): how a message is sent, and whether coach replies
// type out or appear at once. Both live in the learner's `preferences` sync
// record (`sendKey`, `instantText`) and apply to every chat in plato. Pure
// helpers, unit-tested in client/tests/chatPrefs.test.js.

export const SEND_KEYS = Object.freeze({ MOD_ENTER: 'mod-enter', ENTER: 'enter' });

export const isMacLike = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

export function sendKeyOf(prefs) {
  return prefs?.sendKey === SEND_KEYS.ENTER ? SEND_KEYS.ENTER : SEND_KEYS.MOD_ENTER;
}

/**
 * Whether a textarea keydown should send. Cmd/Ctrl+Enter always sends. With
 * the Enter preference, a plain Enter sends too and Shift+Enter is a new
 * line. Enter that confirms an IME composition (e.g. Japanese input) never
 * sends.
 */
export function isSendKeystroke(e, sendKey) {
  if (e.key !== 'Enter' || e.isComposing || e.nativeEvent?.isComposing) return false;
  if (e.metaKey || e.ctrlKey) return true;
  return sendKey === SEND_KEYS.ENTER && !e.shiftKey && !e.altKey;
}

/** The visible shortcut hint next to the composer's send button. */
export function sendHint(sendKey, mac = isMacLike()) {
  if (sendKey === SEND_KEYS.ENTER) return 'Enter to send, Shift+Enter for a new line';
  return `${mac ? '⌘' : 'Ctrl'}+Enter to send`;
}

/** Replies appear at once with the preference, or when the device asks for reduced motion. */
export function wantsInstantText(prefs, reducedMotion = prefersReducedMotion()) {
  return prefs?.instantText === true || (prefs?.instantText !== false && reducedMotion);
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Reveal pacing for streamed replies: about 33 characters a second while the
// model is still sending, but never more than ~1.2 s behind it, and once the
// model is done the rest drains in under a second, so a fast stream never
// leaves a long typing backlog.
export const REVEAL_MS_PER_CHAR = 30;
const MAX_LAG_TICKS = 40;
const DRAIN_TICKS = 15;

/** Next number of characters to show, given what's buffered and the time since the last step. */
export function nextRevealPosition({ pos, length, elapsedMs, done = false, instant = false }) {
  if (instant || pos >= length) return length;
  const backlog = length - pos;
  const steady = Math.max(1, Math.floor(elapsedMs / REVEAL_MS_PER_CHAR));
  // Done: shrink the backlog geometrically, with a floor sized to the whole
  // reply so the tail doesn't crawl one character at a time.
  const catchUp = done
    ? Math.max(Math.ceil(backlog / DRAIN_TICKS), Math.ceil(length / (2 * DRAIN_TICKS)))
    : Math.ceil(backlog / MAX_LAG_TICKS);
  return Math.min(length, pos + Math.max(steady, catchUp));
}
