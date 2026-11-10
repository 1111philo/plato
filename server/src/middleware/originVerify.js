/**
 * Only CloudFront may reach the app. CloudFront adds
 * `X-Plato-Origin-Verify: <secret>` to every request it forwards (a custom
 * origin header on the distribution); anything without it reached the Lambda
 * Function URL or the API Gateway URL directly, which skips the WAF sign-in
 * rate rule and lets the caller choose its own X-Forwarded-For (so per-IP
 * limits in lib/rate-limit.js could be dodged). Those requests get a 403.
 *
 * The secret comes from `ORIGIN_VERIFY` (SSM `/plato/<stage>/origin-verify`,
 * see docs/DEPLOY.md). `off` (or unset) disables the check, for local dev
 * and installs without CloudFront. A comma-separated list is accepted so the
 * secret can be rotated: add the new value here, switch CloudFront, then
 * remove the old one.
 */
import { timingSafeEqual } from 'node:crypto';

export const ORIGIN_VERIFY_HEADER = 'x-plato-origin-verify';

function secrets() {
  const raw = (process.env.ORIGIN_VERIFY || '').trim();
  if (!raw || raw.toLowerCase() === 'off') return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function originVerify(c, next) {
  const allowed = secrets();
  if (!allowed) return next();
  const sent = c.req.header(ORIGIN_VERIFY_HEADER) || '';
  if (sent && allowed.some((s) => same(sent, s))) return next();
  return c.json({ error: 'Forbidden', code: 'origin_not_verified' }, 403);
}
