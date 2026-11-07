import { Hono } from 'hono';
import db from '../lib/db.js';
import { readWaitlistConfig, hasValidApiKey, validateWaitlistEntry, waitlistTokenFor } from '../lib/waitlist.js';
import { readAutomations, sendTemplated } from '../lib/notifications.js';
import { logger } from '../lib/logger.js';
import { clientIp, createLimiter } from '../lib/rate-limit.js';

const waitlist = new Hono();

// Unkeyed joins per client IP: at most JOIN_LIMIT per JOIN_WINDOW_MS, per
// container (best-effort; a keyed outside form is exempt). Once the
// wait-list confirmation is on, each join can send an email, so one source
// mustn't be able to spray them. clientIp: see lib/rate-limit.js.
export const JOIN_LIMIT = 5;
export const JOIN_WINDOW_MS = 10 * 60 * 1000;
const joins = createLimiter({ limit: JOIN_LIMIT, windowMs: JOIN_WINDOW_MS });
const overLimit = (ip) => joins.hit(ip);
export function _resetJoinLimit() { joins.reset(); }
export { clientIp };

// GET /v1/waitlist — public. Whether the "Join the wait list" form is open.
waitlist.get('/v1/waitlist', async (c) => {
  const { config } = await readWaitlistConfig();
  return c.json({ open: !!config.open });
});

// POST /v1/waitlist — public. Accepted when the list is open, or with the
// wait-list API key (for an outside form, even when the list is closed).
// Always answers the same way once the input is valid, so the reply never
// says whether an email already has an account, invite, or entry.
waitlist.post('/v1/waitlist', async (c) => {
  const { config } = await readWaitlistConfig();
  const keyed = hasValidApiKey(c.req.header('Authorization'), config);
  if (!config.open && !keyed) {
    return c.json({ error: 'The wait list is closed' }, 403);
  }

  if (!keyed) {
    if (overLimit(clientIp(c))) return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Honeypot: the public form has a hidden `website` input people never see.
  // A bot that fills every field gets the normal reply and nothing is stored.
  // Keyed (server-to-server) requests skip this.
  if (!keyed && typeof body?.website === 'string' && body.website.trim()) {
    return c.json({ ok: true }, 202);
  }

  const settings = await db.getSyncData('_system', 'settings');
  const result = validateWaitlistEntry(body, settings?.data || {});
  if (result.error) return c.json({ error: result.error }, 400);

  // Store the submission even when the email already has an account or a
  // pending invite: admins need to see what the person sent (the Wait List
  // marks them "Has an account" / "Invited"). Only a repeat join for an email
  // already on the wait list stores nothing. The reply is the same either
  // way, so it never reveals who's registered.
  if (!(await db.getWaitlistEntryByEmail(result.email))) {
    let created = false;
    try {
      await db.createWaitlistEntry({ inviteToken: waitlistTokenFor(result.email), email: result.email, profile: result.profile });
      created = true;
    } catch (err) {
      // A concurrent join for the same email won the create-only write — same
      // outcome as a repeat join, same reply.
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
    // #388: confirm once. Only the request that created the entry sends, so a
    // retry or a duplicate join (which finds the entry) never sends again.
    // A failure is logged and never fails the join. Someone who already has
    // an account or an invite isn't told they're waiting for one.
    if (created) {
      try {
        if ((await readAutomations()).waitlistConfirmation
          && !(await db.getUserByEmail(result.email)) && !(await db.getInviteByEmail(result.email))) {
          await sendTemplated('waitlist-confirmation', { to: result.email, vars: { firstName: result.profile.firstName } });
        }
      } catch (err) {
        logger.error('waitlist_confirmation_failed', { error: err?.message || String(err) });
      }
    }
  }
  return c.json({ ok: true }, 202);
});

export default waitlist;
