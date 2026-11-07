import { Hono } from 'hono';
import { authenticate } from '../middleware/authenticate.js';
import { fetchUrlContent } from '../lib/link-extractor.js';
import { LinkError } from '../lib/url-guard.js';

const links = new Hono();

links.use('/v1/links/*', authenticate);

// Per user, per container (best-effort, like the AI limits in
// lib/ai-limits.js): each fetch is an outbound request from inside AWS, so one
// account can't turn it into a crawler. A learner attaches up to 3 links a turn.
export const LINK_FETCHES_PER_MINUTE = 20;
const recentFetches = new Map(); // userId -> [timestamps]
function overLinkLimit(userId, now = Date.now()) {
  const times = (recentFetches.get(userId) || []).filter((t) => now - t < 60_000);
  if (times.length >= LINK_FETCHES_PER_MINUTE) {
    recentFetches.set(userId, times);
    return 60_000 - (now - times[0]);
  }
  times.push(now);
  recentFetches.set(userId, times);
  if (recentFetches.size > 10_000) recentFetches.clear(); // bound memory
  return 0;
}
export function _resetLinkLimit() { recentFetches.clear(); }

// Fetch a user-supplied URL server-side, extract its readable text, and return
// it so the client can attach it to a coach message (analogous to images).
// SSRF defense + size/time caps live in link-extractor.js / url-guard.js.
links.post('/v1/links/fetch', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request body.' }, 400);
  }
  const wait = overLinkLimit(c.get('userId'));
  if (wait) {
    c.header('Retry-After', String(Math.ceil(wait / 1000)));
    return c.json({ error: 'Too many links at once. Please wait a moment.', code: 'rate_limited', retryAfterMs: wait }, 429);
  }
  const url = body?.url;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return c.json({ error: 'A url is required.' }, 400);
  }

  try {
    const result = await fetchUrlContent(url.trim());
    return c.json(result);
  } catch (e) {
    if (e instanceof LinkError) {
      return c.json({ error: e.message, code: e.code }, e.status);
    }
    return c.json({ error: "Couldn't load that link." }, 502);
  }
});

export default links;
