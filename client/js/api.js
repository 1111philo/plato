/**
 * AI API utilities — parsing and streaming helpers.
 * All API calls go through the server proxy (authenticatedFetch).
 */

// The single model behind every agent. Must match `LLM` in
// server/src/lib/ai-provider.js, which resolves it to a Bedrock model ID.
export const LLM = 'qwen3-vl-235b';

export class ApiError extends Error {
  constructor(type, message, status) {
    super(message);
    this.name = 'ApiError';
    this.type = type;   // 'invalid_key' | 'rate_limit' | 'network' | 'parse' | 'api'
    this.status = status;
  }
}

/**
 * Parse a Messages API response.
 * Expects a fetch Response object. Returns { content, usage }.
 */
export async function parseResponse(resp) {
  if (!resp.ok) {
    const status = resp.status;
    let body;
    try { body = await resp.json(); } catch { body = {}; }
    const msg = body?.error?.message || body?.error || `API returned ${status}`;

    if (status === 401) throw new ApiError('invalid_key', 'Session expired. Please sign in again.', status);
    if (status === 429) throw new ApiError('rate_limit', 'Rate limited. Try again in a moment.', status);
    if (status === 503 || status === 529) throw new ApiError('overloaded', 'API is temporarily overloaded. Retrying...', status);
    if (status === 500) throw new ApiError('api', 'Internal server error. This may be a temporary issue.', status);
    throw new ApiError('api', msg, status);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new ApiError('parse', 'Failed to parse API response.');
  }

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new ApiError('parse', 'No text content in API response.');

  if (data.stop_reason === 'max_tokens') {
    console.warn('[plato] Response truncated — max_tokens reached. Output may be incomplete.');
  }

  return { content: textBlock.text, usage: data.usage };
}

/**
 * Parse an SSE stream from the Messages API proxy.
 * Yields text delta strings as they arrive.
 *
 * Throws instead of ending quietly when the stream didn't finish: the server
 * sends `{type:'error'}` if Bedrock fails mid-stream, and always ends a good
 * stream with `[DONE]` — so a stream that stops without one (connection cut,
 * Lambda timeout) was truncated. Ending "successfully" in either case used to
 * hand callers a partial reply that was then parsed and saved as a real turn.
 */
// `failOnTruncation`: a reply cut off at max_tokens (message_delta
// stop_reason 'max_tokens') throws instead of returning, for callers that
// parse tags out of the full text (the coach: a clipped [PROGRESS]/[KB_UPDATE]
// would be saved as a real turn). Authoring chats keep their partial text.
export async function* parseSSEStream(body, onDone, { failOnTruncation = false } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          if (truncated && failOnTruncation) throw new ApiError('truncated', 'The reply was cut off. Please try again.');
          return;
        }

        let event;
        try { event = JSON.parse(data); } catch { continue; }

        if (event.type === 'error') {
          throw new ApiError('api', 'The response failed partway through. Please try again.');
        }
        if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') truncated = true;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    }
    throw new ApiError('network', 'The response was interrupted. Please try again.');
  } finally {
    reader.releaseLock();
    onDone?.();
  }
}
