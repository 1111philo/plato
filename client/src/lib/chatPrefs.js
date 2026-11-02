// Chat preferences (#247): how a message is sent. Lives in the learner's
// `preferences` sync record (`sendKey`) and applies to every chat in plato.
// Pure helpers, unit-tested in client/tests/chatPrefs.test.js. (Coach replies
// show as they stream in; there's no typing animation or preference for it. A
// stored `instantText` from before is ignored.)

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
