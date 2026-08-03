/**
 * Tests for the Anthropic ⇄ Bedrock Converse translation layer.
 *
 * plato speaks the Anthropic Messages shape internally (the client's
 * `parseResponse` / `parseSSEStream` in `client/js/api.js` parse nothing else),
 * so these tests pin both directions of the translation: request bodies going
 * out to Converse, and responses / stream events coming back.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toConverseRequest,
  fromConverseResponse,
  fromConverseStreamEvent,
} from '../../src/lib/converse.js';

const MODEL = 'qwen.qwen3-vl-235b-a22b';

describe('toConverseRequest', () => {
  it('maps a plain text turn', () => {
    const input = toConverseRequest(MODEL, {
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    assert.equal(input.modelId, MODEL);
    assert.deepEqual(input.messages, [{ role: 'user', content: [{ text: 'Hi' }] }]);
    assert.equal(input.inferenceConfig.maxTokens, 512);
  });

  it('lifts a string system prompt into a system block', () => {
    const input = toConverseRequest(MODEL, {
      max_tokens: 64,
      system: 'You are a coach.',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    assert.deepEqual(input.system, [{ text: 'You are a coach.' }]);
  });

  it('omits system entirely when not provided', () => {
    const input = toConverseRequest(MODEL, {
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    assert.equal('system' in input, false);
  });

  it('defaults maxTokens when absent', () => {
    const input = toConverseRequest(MODEL, { messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(input.inferenceConfig.maxTokens, 1024);
  });

  it('decodes base64 images to bytes with a Converse format', () => {
    // Learners paste screenshots into the coach; `imageCompression.js` emits
    // JPEG data URLs, which `lessonEngine.js` splits into Anthropic image blocks.
    const data = Buffer.from('not-a-real-jpeg').toString('base64');
    const input = toConverseRequest(MODEL, {
      max_tokens: 64,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: 'What is this?' },
        ],
      }],
    });

    const [image, text] = input.messages[0].content;
    assert.equal(image.image.format, 'jpeg');
    assert.ok(Buffer.isBuffer(image.image.source.bytes));
    assert.equal(image.image.source.bytes.toString(), 'not-a-real-jpeg');
    assert.deepEqual(text, { text: 'What is this?' });
  });

  it('accepts every image format Bedrock supports', () => {
    for (const [mediaType, format] of Object.entries({
      'image/png': 'png',
      'image/jpeg': 'jpeg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    })) {
      const input = toConverseRequest(MODEL, {
        messages: [{
          role: 'user',
          content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: 'AAAA' } }],
        }],
      });
      assert.equal(input.messages[0].content[0].image.format, format);
    }
  });

  it('throws on an unsupported image media type', () => {
    assert.throws(() => toConverseRequest(MODEL, {
      messages: [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'AAAA' } }],
      }],
    }), /Unsupported image media type/);
  });

  it('throws on an unsupported content block type', () => {
    assert.throws(() => toConverseRequest(MODEL, {
      messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }],
    }), /Unsupported content block type/);
  });

  it('passes temperature and stop sequences through when present', () => {
    const input = toConverseRequest(MODEL, {
      max_tokens: 32,
      temperature: 0.2,
      stop_sequences: ['END'],
      messages: [{ role: 'user', content: 'Hi' }],
    });

    assert.equal(input.inferenceConfig.temperature, 0.2);
    assert.deepEqual(input.inferenceConfig.stopSequences, ['END']);
  });

  it('omits temperature when not set rather than sending undefined', () => {
    const input = toConverseRequest(MODEL, { messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal('temperature' in input.inferenceConfig, false);
    assert.equal('stopSequences' in input.inferenceConfig, false);
  });
});

describe('fromConverseResponse', () => {
  it('produces the Anthropic response shape the client parses', () => {
    const result = fromConverseResponse({
      output: { message: { role: 'assistant', content: [{ text: 'Nice work. [PROGRESS: 7]' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 3994, outputTokens: 296 },
    });

    assert.deepEqual(result.content, [{ type: 'text', text: 'Nice work. [PROGRESS: 7]' }]);
    assert.equal(result.stop_reason, 'end_turn');
    assert.deepEqual(result.usage, { input_tokens: 3994, output_tokens: 296 });
  });

  it('concatenates multiple text blocks so tags spanning blocks still parse', () => {
    const result = fromConverseResponse({
      output: { message: { content: [{ text: 'Good. [PROG' }, { text: 'RESS: 10]' }] } },
      stopReason: 'end_turn',
    });

    assert.equal(result.content[0].text, 'Good. [PROGRESS: 10]');
  });

  it('drops reasoning blocks, keeping only visible text', () => {
    // plato parses literal tags out of visible text; a reasoning trace is not
    // part of that contract and must never reach the tag parser.
    const result = fromConverseResponse({
      output: {
        message: {
          content: [
            { reasoningContent: { reasoningText: { text: 'Let me think...' } } },
            { text: 'Answer.' },
          ],
        },
      },
      stopReason: 'end_turn',
    });

    assert.equal(result.content[0].text, 'Answer.');
  });

  it('maps max_tokens so the client can warn about truncation', () => {
    const result = fromConverseResponse({
      output: { message: { content: [{ text: 'cut off' }] } },
      stopReason: 'max_tokens',
    });

    assert.equal(result.stop_reason, 'max_tokens');
  });

  it('normalizes a guardrail stop into content_filtered', () => {
    const result = fromConverseResponse({
      output: { message: { content: [{ text: '' }] } },
      stopReason: 'guardrail_intervened',
    });

    assert.equal(result.stop_reason, 'content_filtered');
  });

  it('returns an empty text block and zero usage for a malformed response', () => {
    const result = fromConverseResponse({});
    assert.deepEqual(result.content, [{ type: 'text', text: '' }]);
    assert.deepEqual(result.usage, { input_tokens: 0, output_tokens: 0 });
  });
});

describe('fromConverseStreamEvent', () => {
  it('translates a text delta into content_block_delta', () => {
    const event = fromConverseStreamEvent({
      contentBlockDelta: { delta: { text: 'Hello' }, contentBlockIndex: 0 },
    });

    // This exact shape is what `parseSSEStream` in client/js/api.js matches on.
    assert.equal(event.type, 'content_block_delta');
    assert.equal(event.delta.type, 'text_delta');
    assert.equal(event.delta.text, 'Hello');
    assert.equal(event.index, 0);
  });

  it('drops a delta with no text (reasoning or tool deltas)', () => {
    assert.equal(fromConverseStreamEvent({ contentBlockDelta: { delta: { reasoningContent: {} } } }), null);
  });

  it('translates messageStart, contentBlockStop and messageStop', () => {
    assert.equal(fromConverseStreamEvent({ messageStart: { role: 'assistant' } }).type, 'message_start');
    assert.equal(fromConverseStreamEvent({ contentBlockStop: { contentBlockIndex: 0 } }).type, 'content_block_stop');

    const stop = fromConverseStreamEvent({ messageStop: { stopReason: 'end_turn' } });
    assert.equal(stop.type, 'message_delta');
    assert.equal(stop.delta.stop_reason, 'end_turn');
  });

  it('surfaces usage from the trailing metadata event', () => {
    const event = fromConverseStreamEvent({ metadata: { usage: { inputTokens: 100, outputTokens: 20 } } });
    assert.equal(event.type, 'message_stop');
    assert.deepEqual(event.usage, { input_tokens: 100, output_tokens: 20 });
  });

  it('returns null for unrecognized events', () => {
    assert.equal(fromConverseStreamEvent({ someFutureEvent: {} }), null);
  });

  it('reassembles a full stream into the text the client would render', () => {
    // Event order verified against Bedrock ConverseStream for both Anthropic and
    // open-weight models: messageStart → delta* → stop → messageStop → metadata.
    const raw = [
      { messageStart: { role: 'assistant' } },
      { contentBlockDelta: { delta: { text: 'Great ' }, contentBlockIndex: 0 } },
      { contentBlockDelta: { delta: { text: 'answer. [PROGRESS: 10]' }, contentBlockIndex: 0 } },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } },
    ];

    const translated = raw.map(fromConverseStreamEvent).filter(Boolean);
    const text = translated
      .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');

    assert.equal(text, 'Great answer. [PROGRESS: 10]');
    assert.deepEqual(translated.map((e) => e.type), [
      'message_start', 'content_block_delta', 'content_block_delta',
      'content_block_stop', 'message_delta', 'message_stop',
    ]);
  });
});
