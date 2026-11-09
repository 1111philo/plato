/**
 * Best-effort request limits for public endpoints (wait list, sign-in,
 * password reset, signup). Counts live in the container's memory, so each
 * Lambda container counts on its own: a burst spread across many containers
 * can get past a limit. They stop one source hammering one container; an
 * edge rate rule (WAF) is the exact control (docs/DEPLOY.md).
 */

/**
 * The caller's IP for a limiter. CloudFront *appends* the viewer's address
 * to any X-Forwarded-For the sender wrote, so only the rightmost entry is
 * trustworthy; the leftmost is whatever the sender chose. The Lambda's own
 * source address (CloudFront's, behind it) is dropped from the end in case
 * the Function URL appended it, and used when there's no header at all.
 * A request sent straight to the Function URL, skipping CloudFront, can still
 * choose its entry.
 */
export function clientIp(c) {
  const rc = c.env?.requestContext || c.env?.event?.requestContext;
  const source = rc?.http?.sourceIp || rc?.identity?.sourceIp || '';
  const hops = (c.req.header('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  while (hops.length > 1 && hops[hops.length - 1] === source) hops.pop();
  return hops[hops.length - 1] || source;
}

const limiters = new Set();

/**
 * A sliding-window limiter: `hit(key)` records one attempt and returns true
 * when the key is over `limit` within `windowMs`. An empty key is never
 * limited. Memory is bounded (cleared past `maxKeys`).
 */
export function createLimiter({ limit, windowMs, maxKeys = 10_000 }) {
  const seen = new Map(); // key -> [timestamps]
  const limiter = {
    hit(key, now = Date.now()) {
      if (!key) return false;
      const times = (seen.get(key) || []).filter((t) => now - t < windowMs);
      times.push(now);
      seen.set(key, times);
      if (seen.size > maxKeys) seen.clear();
      return times.length > limit;
    },
    reset() { seen.clear(); },
  };
  limiters.add(limiter);
  return limiter;
}

/** Tests: clear every limiter. */
export function _resetAllLimits() {
  for (const l of limiters) l.reset();
}

/** Read a JSON body; null when it isn't valid JSON (the caller answers 400). */
export async function readJson(c) {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}
