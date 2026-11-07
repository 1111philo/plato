/**
 * AI API utilities — parsing and streaming helpers.
 * All API calls go through the server proxy (authenticatedFetch).
 */

// The single model behind every agent. Must match `LLM` in
// server/src/lib/ai-provider.js, which resolves it to a Bedrock model ID.
export const LLM = 'qwen3-vl-235b';

export class ApiError extends Error {
  constructor(type, message, status, retryAfterMs) {
    super(message);
    this.name = 'ApiError';
    // 'invalid_key' | 'rate_limit' | 'overloaded' | 'timeout' | 'network' | 'parse' | 'truncated' | 'api'
    this.type = type;
    this.status = status;
    // When the server says how long to wait (busy / rate-limited), in ms.
    this.retryAfterMs = retryAfterMs;
  }
}

/** True for errors worth waiting out and trying again: busy, rate-limited, timed out, or a 5xx. */
export function isRetryable(e) {
  return e?.type === 'rate_limit' || e?.type === 'overloaded' || e?.type === 'timeout' || (e?.type === 'api' && e?.status >= 500);
}

/**
 * Wait before retry number `attempt` (0 = first retry): the server's
 * `retryAfterMs` if it gave one, else exponential from `baseMs`, with
 * jitter so many clients that failed together don't retry together.
 */
export function backoffMs(attempt, retryAfterMs, { baseMs = 2000, rand = Math.random } = {}) {
  const wait = Math.max(retryAfterMs || 0, baseMs * 2 ** attempt);
  return Math.round(wait * (1 + 0.5 * rand()));
}

// The server's typed AI errors (server/src/lib/ai-limits.js).
const TYPE_FOR_CODE = { throttled: 'rate_limit', rate_limited: 'rate_limit', overloaded: 'overloaded', timeout: 'timeout' };
function aiErrorMessage(type, retryAfterMs) {
  const secs = retryAfterMs ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : null;
  if (type === 'rate_limit') return secs ? `plato is busy right now. Try again in ${secs} second${secs === 1 ? '' : 's'}.` : 'plato is busy right now. Try again in a moment.';
  if (type === 'overloaded') return 'The AI service is having trouble. Try again in a moment.';
  if (type === 'timeout') return 'The reply took too long. Please try again.';
  return null;
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
    const retryAfterMs = Number(body?.retryAfterMs) || (Number(resp.headers?.get?.('retry-after')) * 1000) || undefined;

    if (status === 401) throw new ApiError('invalid_key', 'Session expired. Please sign in again.', status);
    const type = TYPE_FOR_CODE[body?.code] || (status === 429 ? 'rate_limit' : status === 503 || status === 529 ? 'overloaded' : status === 504 ? 'timeout' : null);
    if (type) throw new ApiError(type, aiErrorMessage(type, retryAfterMs), status, retryAfterMs);
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
          const type = TYPE_FOR_CODE[event.error?.code];
          const retryAfterMs = Number(event.error?.retryAfterMs) || undefined;
          throw new ApiError(type || 'api', (type && aiErrorMessage(type, retryAfterMs)) || 'The response failed partway through. Please try again.', undefined, retryAfterMs);
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
