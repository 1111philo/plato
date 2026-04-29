/**
 * Slack plugin — server side.
 *
 * Routes mounted at /v1/plugins/slack/. Auth + admin middleware applied per-route
 * (the host's plugin-mount middleware only gates on enabled state, not auth).
 *
 * onActivate migrates settings from the legacy `_system:settings.slack` location
 * (where they lived before plato had a plugin system) into the plugin's own
 * settings record. Idempotent — safe to run on every boot.
 */

import {
  Hono,
  db,
  authenticate,
  requireAdmin,
  generateInviteToken,
  APP_URL,
} from '../../../server/src/lib/plugins/sdk.js';
import {
  testSlackConnection,
  searchSlackUsers,
  listSlackChannels,
  listChannelMembers,
  sendSlackDM,
} from './slack-client.js';

const routes = new Hono();

// All Slack routes require auth + admin. The plugin host adds its own enabled-gate.
routes.use('*', authenticate, requireAdmin);

// Helper: read the plugin's stored bot token from the activation record.
async function getSlackToken() {
  const item = await db.getSyncData('_system', 'plugins:activation');
  return item?.data?.slack?.settings?.botToken || null;
}

async function getClassroomName() {
  const item = await db.getSyncData('_system', 'settings');
  const s = item?.data || {};
  return s.classroomName || s.logoAlt || 'plato';
}

// POST /v1/plugins/slack/admin/test — validate a bot token
routes.post('/admin/test', async (c) => {
  const { botToken } = await c.req.json();
  if (!botToken) return c.json({ error: 'botToken is required' }, 400);
  try {
    const result = await testSlackConnection(botToken);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'Invalid token or Slack API error', detail: e.message }, 400);
  }
});

// GET /v1/plugins/slack/admin/users?q= — search workspace users
routes.get('/admin/users', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);
  try {
    const q = c.req.query('q') || '';
    const users = await searchSlackUsers(token, q);
    return c.json(users);
  } catch (e) {
    return c.json({ error: 'Slack API error', detail: e.message }, 500);
  }
});

// GET /v1/plugins/slack/admin/channels — list public channels
routes.get('/admin/channels', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);
  try {
    const channels = await listSlackChannels(token);
    return c.json(channels);
  } catch (e) {
    return c.json({ error: 'Slack API error', detail: e.message }, 500);
  }
});

// GET /v1/plugins/slack/admin/channels/:id/members — list channel members
routes.get('/admin/channels/:id/members', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);
  try {
    const members = await listChannelMembers(token, c.req.param('id'));
    return c.json(members);
  } catch (e) {
    return c.json({ error: 'Slack API error', detail: e.message }, 500);
  }
});

// POST /v1/plugins/slack/admin/invites — invite users via Slack DM
routes.post('/admin/invites', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);

  const { users } = await c.req.json();
  if (!Array.isArray(users) || users.length === 0) {
    return c.json({ error: 'users array is required' }, 400);
  }
  if (users.length > 200) {
    return c.json({ error: 'Maximum 200 invites per batch' }, 400);
  }

  const adminUser = c.get('user');
  const classroom = await getClassroomName();

  const results = [];
  for (const u of users) {
    const email = (u.email || '').trim().toLowerCase();
    if (!email) {
      results.push({ slackUserId: u.slackUserId, status: 'skipped', reason: 'No email on Slack profile' });
      continue;
    }

    const existing = await db.getUserByEmail(email);
    if (existing) {
      results.push({ email, slackUserId: u.slackUserId, status: 'skipped', reason: 'User already exists' });
      continue;
    }

    const pendingInvite = await db.getInviteByEmail(email);
    if (pendingInvite) {
      results.push({ email, slackUserId: u.slackUserId, status: 'skipped', reason: 'Pending invite already exists' });
      continue;
    }

    try {
      const inviteToken = generateInviteToken();
      await db.createInvite({
        inviteToken,
        email,
        invitedBy: adminUser.userId,
        slackUserId: u.slackUserId,
      });

      const signupUrl = `${APP_URL}/signup?token=${inviteToken}`;
      // Compose so the fallback doesn't double-up "you" (was: "You've been invited you...").
      const opener = adminUser.name
        ? `${adminUser.name} has invited you`
        : `You've been invited`;
      const message = `${opener} to join *${classroom}*.\n\n<${signupUrl}|Create your account>\n\nThis invite expires in 7 days.`;

      await sendSlackDM(token, u.slackUserId, message);
      results.push({ email, slackUserId: u.slackUserId, status: 'sent' });
    } catch (err) {
      results.push({ email, slackUserId: u.slackUserId, status: 'error', reason: err.message });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status !== 'sent').length;
  return c.json({ sent, skipped, total: results.length, results }, 201);
});

/**
 * Migrate Slack settings from the legacy location (`_system:settings.slack`,
 * where they lived before plato had a plugin system) into the plugin's own
 * settings record. Idempotent.
 */
async function migrateLegacySettings(ctx) {
  try {
    const legacy = await db.getSyncData('_system', 'settings');
    const slackLegacy = legacy?.data?.slack;
    if (!slackLegacy) return;
    const hasMigrated = ctx.settings && Object.keys(ctx.settings).length > 0;
    if (hasMigrated) return;
    const next = {
      botToken: slackLegacy.botToken || null,
      workspaceName: slackLegacy.workspaceName || null,
      connected: !!slackLegacy.connected,
    };
    await ctx.setSettings(next);
    // Strip the legacy slack key so future loads don't trigger this branch.
    const cleaned = { ...(legacy.data || {}) };
    delete cleaned.slack;
    await db.putSyncData('_system', 'settings', cleaned, legacy.version || 0);
    ctx.logger.info('settings_migrated', { from: '_system:settings.slack' });
  } catch (err) {
    ctx.logger.warn('settings_migration_failed', { error: err?.message });
  }
}

export default {
  routes,
  async onActivate(ctx) {
    await migrateLegacySettings(ctx);
  },
  // No `onUninstall` defined — Slack's only data is bot token/workspace name
  // in its settings record, which the host clears automatically when the
  // admin confirms "Delete plugin data". Plugins implement onUninstall only
  // when they have data outside the activation record (e.g. teacher-comments
  // wipes per-user `userMeta:teacher-comments` records).
};
