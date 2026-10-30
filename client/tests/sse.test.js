/**
 * parseSSEStream (client/js/api.js): a stream only counts as complete when it
 * ends with [DONE]. A server error event or a cut-off stream must throw, so a
 * partial reply is never parsed and saved as a real coach turn.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSEStream, ApiError } from '../js/api.js';

function body(...chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}
const delta = (text) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;

async function collect(stream) {
  let out = '';
  for await (const t of parseSSEStream(stream)) out += t;
  return out;
}

describe('parseSSEStream', () => {
  it('yields text and finishes on [DONE]', async () => {
    assert.equal(await collect(body(delta('Hel'), delta('lo'), 'data: [DONE]\n\n')), 'Hello');
  });

  it('handles events split across chunks', async () => {
    const full = delta('split') + 'data: [DONE]\n\n';
    assert.equal(await collect(body(full.slice(0, 17), full.slice(17))), 'split');
  });

  it('throws on a server error event instead of returning the partial text', async () => {
    const stream = body(delta('partial'), `data: ${JSON.stringify({ type: 'error', error: { message: 'boom' } })}\n\n`);
    await assert.rejects(collect(stream), (e) => e instanceof ApiError && e.type === 'api');
  });

  it('throws when the stream ends without [DONE] (truncated)', async () => {
    await assert.rejects(collect(body(delta('cut off mid-'))), (e) => e instanceof ApiError && e.type === 'network');
  });

  it('calls onDone either way', async () => {
    let calls = 0;
    await assert.rejects((async () => { for await (const _ of parseSSEStream(body(delta('x')), () => calls++)) { /* drain */ } })());
    for await (const _ of parseSSEStream(body('data: [DONE]\n\n'), () => calls++)) { /* drain */ }
    assert.equal(calls, 2);
  });
});
