/**
 * Chat preferences and reveal pacing (#247, src/lib/chatPrefs.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEND_KEYS, sendKeyOf, isSendKeystroke, sendHint, wantsInstantText, nextRevealPosition, REVEAL_MS_PER_CHAR } from '../src/lib/chatPrefs.js';

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

describe('instant text', () => {
  it('follows the preference, and reduced motion when the learner has not chosen', () => {
    assert.equal(wantsInstantText({ instantText: true }, false), true);
    assert.equal(wantsInstantText({}, true), true);
    assert.equal(wantsInstantText({ instantText: false }, true), false, 'an explicit "off" wins over reduced motion');
    assert.equal(wantsInstantText({}, false), false);
  });
});

describe('nextRevealPosition', () => {
  it('types at the steady pace with a small backlog', () => {
    assert.equal(nextRevealPosition({ pos: 0, length: 20, elapsedMs: REVEAL_MS_PER_CHAR }), 1);
    assert.equal(nextRevealPosition({ pos: 0, length: 20, elapsedMs: REVEAL_MS_PER_CHAR * 3 }), 3);
  });
  it('a throttled tick (background tab) catches up by elapsed time', () => {
    assert.equal(nextRevealPosition({ pos: 0, length: 500, elapsedMs: 1000 }), 33);
  });
  it('never lags far behind a fast stream', () => {
    // 2000 chars buffered: one tick moves at least 1/40 of the backlog.
    assert.equal(nextRevealPosition({ pos: 0, length: 2000, elapsedMs: 30 }), 50);
  });
  it('drains the rest quickly once the stream is done', () => {
    let pos = 0;
    let ticks = 0;
    while (pos < 1500 && ticks < 100) { pos = nextRevealPosition({ pos, length: 1500, elapsedMs: 30, done: true }); ticks++; }
    assert.equal(pos, 1500);
    assert.ok(ticks <= 30, `drained in ${ticks} ticks (30 ms each)`);
  });
  it('instant shows everything; never overshoots', () => {
    assert.equal(nextRevealPosition({ pos: 0, length: 900, elapsedMs: 0, instant: true }), 900);
    assert.equal(nextRevealPosition({ pos: 899, length: 900, elapsedMs: 5000 }), 900);
  });
});
