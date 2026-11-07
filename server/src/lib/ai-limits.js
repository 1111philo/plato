/**
 * Limits on `POST /v1/ai/messages` (#451 scale review, B4/H3). Every signed-in
 * user can call the AI proxy, so it only accepts plato's own model and calls
 * the size of what plato's agents actually send, and each user gets a rate
 * and a concurrency limit. Errors from Bedrock are typed so clients can tell
 * "busy, try again in N s" from "broken".
 *
 * Request caps, sized against the largest real calls (orchestrator.js,
 * lessonEngine.js, the admin chats, plugins), with headroom:
 * - `model` must be plato's `LLM` (ai-provider.js refuses anything else too).
 * - `max_tokens` 1–4096 (the largest agent asks for 4096: KB extraction).
 * - up to 60 messages (a coach turn sends a 40-message tail + context +
 *   the new turn, ~43; the tag repair adds 2; admin chats send 15).
 * - up to 4 images in one message and 8 in a request (the composer allows 4
 *   per message; the tag repair resends that turn).
 * - a system prompt up to 200,000 characters (coach.md + program knowledge
 *   base + lesson catalog is ~60–100 KB on prod today).
 * - a body up to 5 MB (4 compressed screenshots ≈ 2 MB of base64, plus up to
 *   3 attached pages of ≤ 50,000 characters each). The Function URL's own
 *   limit is 6 MB.
 *
 * Per-user limits are **per container, in memory** (best-effort): a burst
 * spread across Lambda containers can exceed them. A shared counter would
 * need a DynamoDB write on every AI call; per-container already stops one
 * script from running up the bill or pinning streams, which is the point.
 * - 30 calls a minute, burst 30 (a learner turn makes 1–5 calls: the coach,
 *   sometimes a tag repair, profile and unit-note updates).
 * - 4 calls in flight at once (a streaming reply plus its background agents).
 */
import { LLM } from './ai-provider.js';

export const MAX_TOKENS_CAP = 4096;
export const MAX_MESSAGES = 60;
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGES_TOTAL = 8;
export const MAX_SYSTEM_CHARS = 200_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const RATE_PER_MINUTE = 30;
export const MAX_IN_FLIGHT = 4;

const textOf = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('') : '');

/**
 * Check a request body. Returns `{ aiBody, stream }` ready for the provider,
 * or `{ error }` (a 400). `rawBytes` is the body's size as received.
 */
export function validateAiRequest(body, rawBytes = 0) {
  if (rawBytes > MAX_BODY_BYTES) return { error: `Request is too large (over ${MAX_BODY_BYTES / 1024 / 1024} MB)`, status: 413 };
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const { model, max_tokens: maxTokens, system, messages, stream } = body;
  if (!model) return { error: 'model is required' };
  if (model !== LLM) return { error: 'Unknown model' };

  let tokens = 1024;
  if (maxTokens !== undefined && maxTokens !== null) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_CAP) return { error: `max_tokens must be a whole number from 1 to ${MAX_TOKENS_CAP}` };
    tokens = maxTokens;
  }

  if (!messages || !Array.isArray(messages)) return { error: 'messages array is required' };
  if (messages.length === 0) return { error: 'messages must not be empty' };
  if (messages.length > MAX_MESSAGES) return { error: `At most ${MAX_MESSAGES} messages per request` };
  let images = 0;
  for (const msg of messages) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return { error: 'Each message needs a role of user or assistant' };
    // Bedrock returns ValidationException for empty content.
    if (!msg.content || (typeof msg.content === 'string' && !msg.content.trim()) || (Array.isArray(msg.content) && msg.content.length === 0)) {
      return { error: 'messages must have non-empty content' };
    }
    if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) return { error: 'message content must be text or a list of blocks' };
    if (Array.isArray(msg.content)) {
      const here = msg.content.filter((b) => b?.type === 'image').length;
      if (here > MAX_IMAGES_PER_MESSAGE) return { error: `At most ${MAX_IMAGES_PER_MESSAGE} images per message` };
      images += here;
    }
  }
  if (images > MAX_IMAGES_TOTAL) return { error: `At most ${MAX_IMAGES_TOTAL} images per request` };

  if (system !== undefined && system !== null && typeof system !== 'string' && !Array.isArray(system)) return { error: 'system must be text' };
  if (textOf(system).length > MAX_SYSTEM_CHARS) return { error: `system prompt is too long (over ${MAX_SYSTEM_CHARS} characters)` };

  return { aiBody: { max_tokens: tokens, ...(system ? { system } : {}), messages }, stream: !!stream };
}

// ── Per-user rate (token bucket) and concurrency, per container ──────────
const buckets = new Map(); // userId -> { tokens, at, inFlight }

function bucketFor(userId, now) {
  let b = buckets.get(userId);
  if (!b) {
    if (buckets.size > 10_000) {
      // Bound memory: drop idle users first.
      for (const [id, v] of buckets) if (v.inFlight === 0) buckets.delete(id);
    }
    b = { tokens: RATE_PER_MINUTE, at: now, inFlight: 0 };
    buckets.set(userId, b);
  }
  const refill = ((now - b.at) / 60_000) * RATE_PER_MINUTE;
  b.tokens = Math.min(RATE_PER_MINUTE, b.tokens + refill);
  b.at = now;
  return b;
}

/**
 * Take one call for `userId`. Returns `{ ok: true, release }` (call `release`
 * exactly once when the call ends), or `{ ok: false, retryAfterMs, reason }`.
 */
export function acquire(userId, now = Date.now()) {
  const b = bucketFor(userId, now);
  if (b.inFlight >= MAX_IN_FLIGHT) return { ok: false, reason: 'in_flight', retryAfterMs: 2000 };
  if (b.tokens < 1) {
    return { ok: false, reason: 'rate', retryAfterMs: Math.ceil(((1 - b.tokens) / RATE_PER_MINUTE) * 60_000) };
  }
  b.tokens -= 1;
  b.inFlight += 1;
  let released = false;
  return { ok: true, release: () => { if (!released) { released = true; b.inFlight = Math.max(0, b.inFlight - 1); } } };
}

export function _resetAiLimits() { buckets.clear(); }

/**
 * A Bedrock (or provider) error, typed for clients:
 * `{ status, code: 'throttled' | 'overloaded' | 'timeout' | 'failed', message, retryAfterMs? }`.
 */
export function classifyAiError(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  if (name === 'ThrottlingException' || name === 'ServiceQuotaExceededException' || err?.$metadata?.httpStatusCode === 429) {
    return { status: 429, code: 'throttled', message: 'The AI service is busy. Please try again in a moment.', retryAfterMs: 5000 };
  }
  if (['ServiceUnavailableException', 'ModelNotReadyException', 'InternalServerException', 'ModelStreamErrorException'].includes(name)
    || [500, 502, 503].includes(err?.$metadata?.httpStatusCode)) {
    return { status: 503, code: 'overloaded', message: 'The AI service is having trouble. Please try again in a moment.', retryAfterMs: 5000 };
  }
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'ModelTimeoutException' || /timed out/i.test(msg)) {
    return { status: 504, code: 'timeout', message: 'The reply took too long. Please try again.' };
  }
  return { status: 502, code: 'failed', message: 'The AI service returned an error. Please try again.' };
}
