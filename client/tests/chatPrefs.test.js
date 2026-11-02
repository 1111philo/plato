/**
 * Chat preferences (#247, src/lib/chatPrefs.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEND_KEYS, sendKeyOf, isSendKeystroke, sendHint } from '../src/lib/chatPrefs.js';

const key = (over) => ({ key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...over });

describe('send keystroke', () => {
  it('Cmd/Ctrl+Enter always sends', () => {
    for (const k of Object.values(SEND_KEYS)) {
      assert.equal(isSendKeystroke(key({ metaKey: true }), k), true);
      assert.equal(isSendKeystroke(key({ ctrlKey: true }), k), true);
    }
  });
  it('plain Enter sends only with the Enter preference; Shift+Enter never does', () => {
    assert.equal(isSendKeystroke(key(), SEND_KEYS.MOD_ENTER), false);
    assert.equal(isSendKeystroke(key(), SEND_KEYS.ENTER), true);
    assert.equal(isSendKeystroke(key({ shiftKey: true }), SEND_KEYS.ENTER), false);
  });
  it('never sends while an IME composition is being confirmed, or on other keys', () => {
    assert.equal(isSendKeystroke(key({ isComposing: true }), SEND_KEYS.ENTER), false);
    assert.equal(isSendKeystroke(key({ nativeEvent: { isComposing: true } }), SEND_KEYS.ENTER), false);
    assert.equal(isSendKeystroke(key({ key: 'a', metaKey: true }), SEND_KEYS.ENTER), false);
  });
  it('defaults to Cmd/Ctrl+Enter for missing or unknown values', () => {
    assert.equal(sendKeyOf(undefined), SEND_KEYS.MOD_ENTER);
    assert.equal(sendKeyOf({ sendKey: 'shift' }), SEND_KEYS.MOD_ENTER);
    assert.equal(sendKeyOf({ sendKey: 'enter' }), SEND_KEYS.ENTER);
  });
  it('hints match the preference and platform', () => {
    assert.equal(sendHint(SEND_KEYS.MOD_ENTER, true), '⌘+Enter to send');
    assert.equal(sendHint(SEND_KEYS.MOD_ENTER, false), 'Ctrl+Enter to send');
    assert.match(sendHint(SEND_KEYS.ENTER, true), /^Enter to send/);
  });
});
