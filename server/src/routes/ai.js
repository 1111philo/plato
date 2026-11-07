import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { authenticate } from '../middleware/authenticate.js';
import ai from '../lib/ai-provider.js';
import { logger } from '../lib/logger.js';
import { validateAiRequest, acquire, classifyAiError } from '../lib/ai-limits.js';

const aiRoute = new Hono();

aiRoute.use('/v1/ai/*', authenticate);

// POST /v1/ai/events — client-side events only the browser sees, logged so
// they show in /v1/admin/logs (OBSERVABILITY.md): a coach reply's missing tags
// recovered or not, a conversation past the size budget. Known codes only.
const LESSON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
const CLIENT_EVENTS = new Set(['coach_tags_recovered', 'coach_tags_unrecovered', 'conversation_too_long']);
aiRoute.post('/v1/ai/events', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!CLIENT_EVENTS.has(body?.code)) return c.json({ error: 'Unknown event' }, 400);
  // Lesson ids are slugs (`getting-started`, `custom-…`); anything else isn't logged.
  const lessonId = typeof body.lessonId === 'string' && LESSON_ID_RE.test(body.lessonId) ? body.lessonId : null;
  logger.warn(body.code, { userId: c.get('userId'), lessonId });
  return c.json({ ok: true });
});

// POST /v1/ai/messages — the AI proxy every agent uses. plato's own model
// only, sized to what plato's agents send, and limited per user
// (lib/ai-limits.js). Errors are typed: `{ error, code, retryAfterMs? }` with
// code throttled | overloaded | timeout | failed | rate_limited.
aiRoute.post('/v1/ai/messages', async (c) => {
  const raw = await c.req.text();
  let body;
  try { body = JSON.parse(raw); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const checked = validateAiRequest(body, Buffer.byteLength(raw, 'utf8'));
  if (checked.error) return c.json({ error: checked.error }, checked.status || 400);

  const slot = acquire(c.get('userId'));
  if (!slot.ok) {
    logger.warn('ai_rate_limited', { userId: c.get('userId'), reason: slot.reason });
    c.header('Retry-After', String(Math.ceil(slot.retryAfterMs / 1000)));
    return c.json({ error: 'Too many AI requests. Please wait a moment.', code: 'rate_limited', retryAfterMs: slot.retryAfterMs }, 429);
  }
  const fail = (err, logCode) => {
    const t = classifyAiError(err);
    logger.error(logCode, { error: err?.message || String(err), name: err?.name, code: t.code });
    if (t.retryAfterMs) c.header('Retry-After', String(Math.ceil(t.retryAfterMs / 1000)));
    return c.json({ error: t.message, code: t.code, ...(t.retryAfterMs ? { retryAfterMs: t.retryAfterMs } : {}) }, t.status);
  };

  if (!checked.stream) {
    try {
      return c.json(await ai.invoke(body.model, checked.aiBody));
    } catch (err) {
      // Coded like the stream path, so background agents' failures (profile,
      // unit notes, lesson creation, extractors) aren't bare unhandled_errors.
      return fail(err, 'ai_invoke_failed');
    } finally {
      slot.release();
    }
  }

  // Wait for Bedrock's first event before committing the SSE headers, so a
  // throttle or outage at the start is a real 429/503 the client can back off
  // from, not a 200 followed by an error event.
  const events = ai.invokeStream(body.model, checked.aiBody)[Symbol.asyncIterator]();
  let first;
  try {
    first = await events.next();
  } catch (err) {
    slot.release();
    return fail(err, 'ai_stream_failed');
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return stream(c, async (s) => {
    try {
      if (!first.done) {
        await s.write(`data: ${JSON.stringify(first.value)}\n\n`);
        for (let next = await events.next(); !next.done; next = await events.next()) {
          await s.write(`data: ${JSON.stringify(next.value)}\n\n`);
        }
      }
      await s.write('data: [DONE]\n\n');
    } catch (err) {
      // A coded event, so the logs endpoint can count failed AI turns (OBSERVABILITY.md).
      const t = classifyAiError(err);
      logger.error('ai_stream_failed', { error: err?.message || String(err), name: err?.name, code: t.code });
      await s.write(`data: ${JSON.stringify({ type: 'error', error: { message: t.message, code: t.code, ...(t.retryAfterMs ? { retryAfterMs: t.retryAfterMs } : {}) } })}\n\n`);
    } finally {
      slot.release();
    }
  });
});

export default aiRoute;
// Keep backward compat — imported as `ai` in index.js
