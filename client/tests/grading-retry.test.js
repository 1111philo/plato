/**
 * The grading check's retry after an unreadable reply (#604): it goes out at
 * RETRY_TEMPERATURE with the format note, through the real sendMessage path,
 * with Trace off and on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ai, LESSON, reset, signIn, settle } from './helpers/fake-plato.js';

const { clearCache, savePreferences } = await import('../js/storage.js');
const { startLesson, sendMessage } = await import('../src/lib/lessonEngine.js');

const system = (b) => (Array.isArray(b.system) ? b.system.map((x) => x.text || '').join('\n') : String(b.system || ''));
const assessorCalls = () => ai.filter((b) => system(b).startsWith('You check a learner\'s work for plato'));

async function run(trace) {
  reset();
  clearCache();
  signIn();
  if (trace) await savePreferences({ name: '', traceScopes: [LESSON.lessonId] });
  await startLesson(LESSON.lessonId, LESSON, () => {});
  ai.length = 0;
  const result = await sendMessage(LESSON.lessonId, LESSON, 'MOCK_COMPLETE MOCK_GARBLED I applied it to my garden plan.', null, [], () => {});
  await settle();
  return result;
}

describe('grading check retry (#604)', () => {
  for (const trace of [false, true]) {
    it(`asks again at temperature 0.7 with the format note (Trace ${trace ? 'on' : 'off'})`, async () => {
      const result = await run(trace);
      const [first, retry] = assessorCalls();
      assert.equal(first.temperature, 0, 'the first ask is at temperature 0');
      assert.equal(JSON.parse(first.messages[0].content).note, undefined);
      assert.equal(retry.temperature, 0.7, 'the retry is not the identical request');
      assert.match(JSON.parse(retry.messages[0].content).note, /valid JSON/);
      assert.equal(result.achieved, true, 'the readable retry lets the completion through');
    });
  }
});

describe('a reply reaches the learner only after plato has checked it (Blake, 2026-11-25)', () => {
  it('nothing is streamed while the reply is written; the checked reply is returned', async () => {
    reset();
    clearCache();
    signIn();
    await startLesson(LESSON.lessonId, LESSON, () => {});
    const streamed = [];
    const result = await sendMessage(LESSON.lessonId, LESSON, 'MOCK_COMPLETE MOCK_GARBLED I applied it to my garden plan.', null, [], (t) => streamed.push(t));
    await settle();
    assert.deepEqual(streamed, [], 'no unchecked text on screen');
    assert.ok(result.messages.find((m) => m.role === 'assistant')?.content, 'the checked reply is in the result');
  });
});
