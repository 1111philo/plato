/**
 * Translation layer between plato's Anthropic-shaped message bodies and
 * Bedrock's Converse API.
 *
 * plato speaks one wire format end to end: the Anthropic Messages shape
 * (`{ max_tokens, system, messages }` in, `{ content, usage, stop_reason }` out,
 * `content_block_delta` events while streaming). The client parses that shape in
 * `client/js/api.js` and nothing else.
 *
 * Non-Anthropic models on Bedrock are only reachable through Converse /
 * ConverseStream — the legacy `InvokeModel` path does NOT reject them, it
 * returns HTTP 200 with an OpenAI-shaped body, so callers silently read
 * `undefined` instead of text. Rather than teach every caller a second dialect,
 * this module keeps the Anthropic shape as plato's internal lingua franca and
 * translates at the Bedrock boundary.
 *
 * Keeping the translation here (pure functions, no AWS SDK) means it is unit
 * testable without network access.
 */

/** Bedrock Converse accepts these image formats; keys are Anthropic media types. */
const IMAGE_FORMATS = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Converse reports stop reasons in its own vocabulary. Map to the Anthropic
 * names the client checks (it warns on `max_tokens`).
 */
const STOP_REASONS = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  content_filtered: 'content_filtered',
  guardrail_intervened: 'content_filtered',
};

function decodeBase64(data) {
  return Buffer.from(data, 'base64');
}

/** Convert one Anthropic content block to a Converse content block. */
function toConverseBlock(block) {
  if (typeof block === 'string') return { text: block };

  if (block.type === 'text') return { text: block.text };

  if (block.type === 'image') {
    const format = IMAGE_FORMATS[block.source?.media_type];
    if (!format) {
      throw new Error(`Unsupported image media type: ${block.source?.media_type}`);
    }
    if (block.source?.type !== 'base64') {
      throw new Error(`Unsupported image source type: ${block.source?.type}`);
    }
    return { image: { format, source: { bytes: decodeBase64(block.source.data) } } };
  }

  throw new Error(`Unsupported content block type: ${block.type}`);
}

/**
 * Translate an Anthropic-shaped request body into Converse command input.
 *
 * @param {string} modelId  Bedrock model ID (already resolved).
 * @param {object} body     `{ max_tokens, system?, messages }`.
 */
export function toConverseRequest(modelId, body) {
  const { max_tokens: maxTokens, system, messages, temperature, stop_sequences: stopSequences } = body;

  const input = {
    modelId,
    messages: (messages || []).map((msg) => ({
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map(toConverseBlock)
        : [{ text: msg.content }],
    })),
    inferenceConfig: {
      maxTokens: maxTokens || 1024,
      ...(temperature != null ? { temperature } : {}),
      ...(stopSequences ? { stopSequences } : {}),
    },
  };

  // plato always sends `system` as a plain string; Converse wants blocks.
  if (system) {
    input.system = typeof system === 'string' ? [{ text: system }] : system;
  }

  return input;
}

/** Translate a Converse response into the Anthropic response shape. */
export function fromConverseResponse(response) {
  const blocks = response?.output?.message?.content || [];
  const text = blocks
    .filter((b) => typeof b.text === 'string')
    .map((b) => b.text)
    .join('');

  return {
    // `reasoningContent` blocks (thinking models) are deliberately dropped —
    // plato's prompts parse literal `[PROGRESS: n]`-style tags out of visible
    // text, and reasoning traces are not part of that contract.
    content: [{ type: 'text', text }],
    stop_reason: STOP_REASONS[response?.stopReason] || response?.stopReason || null,
    usage: {
      input_tokens: response?.usage?.inputTokens ?? 0,
      output_tokens: response?.usage?.outputTokens ?? 0,
    },
  };
}

/**
 * Translate one ConverseStream event into the Anthropic SSE event the client
 * expects, or `null` for events with no Anthropic equivalent.
 *
 * Verified against Bedrock: Converse streams the same event order for both
 * Anthropic and open-weight models — messageStart → contentBlockDelta* →
 * contentBlockStop → messageStop → metadata.
 */
export function fromConverseStreamEvent(event) {
  if (event.messageStart) {
    return { type: 'message_start', message: { role: event.messageStart.role, content: [] } };
  }

  if (event.contentBlockDelta) {
    const text = event.contentBlockDelta.delta?.text;
    if (typeof text !== 'string') return null; // reasoning / tool deltas
    return {
      type: 'content_block_delta',
      index: event.contentBlockDelta.contentBlockIndex ?? 0,
      delta: { type: 'text_delta', text },
    };
  }

  if (event.contentBlockStop) {
    return { type: 'content_block_stop', index: event.contentBlockStop.contentBlockIndex ?? 0 };
  }

  if (event.messageStop) {
    return {
      type: 'message_delta',
      delta: { stop_reason: STOP_REASONS[event.messageStop.stopReason] || event.messageStop.stopReason || null },
    };
  }

  if (event.metadata) {
    return {
      type: 'message_stop',
      usage: {
        input_tokens: event.metadata.usage?.inputTokens ?? 0,
        output_tokens: event.metadata.usage?.outputTokens ?? 0,
      },
    };
  }

  return null;
}
