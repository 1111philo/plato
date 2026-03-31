/**
 * AI API utilities — parsing and streaming helpers.
 * All API calls go through the server proxy (authenticatedFetch).
 */

export const MODEL_LIGHT = 'claude-haiku-4-5-20251001';
export const MODEL_HEAVY = 'claude-sonnet-4-6';

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
    console.warn('[1111] Response truncated — max_tokens reached. Output may be incomplete.');
  }

  return { content: textBlock.text, usage: data.usage };
}

/**
 * Parse an SSE stream from the Messages API proxy.
 * Yields text delta strings as they arrive.
 */
export async function* parseSSEStream(body, onDone) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        if (data === '[DONE]') return;

        let event;
        try { event = JSON.parse(data); } catch { continue; }

        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    }
  } finally {
    reader.releaseLock();
    onDone?.();
  }
}
