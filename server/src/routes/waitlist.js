import { Hono } from 'hono';
import db from '../lib/db.js';
import { generateInviteToken } from '../lib/crypto.js';
import { readWaitlistConfig, hasValidApiKey, validateWaitlistEntry } from '../lib/waitlist.js';

const waitlist = new Hono();

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

  const known = await db.getUserByEmail(result.email)
    || await db.getInviteByEmail(result.email)
    || await db.getWaitlistEntryByEmail(result.email);
  if (!known) {
    await db.createWaitlistEntry({ inviteToken: generateInviteToken(), email: result.email, profile: result.profile });
  }
  return c.json({ ok: true }, 202);
});

export default waitlist;
