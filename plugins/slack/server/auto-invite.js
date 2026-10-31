/**
 * Auto-invite (#379): when someone's plato account is created, add them to
 * the admin's chosen Slack channel, if they're already in the workspace (we
 * match by email; plato doesn't send workspace invitations).
 *
 * The result is kept per user in the plugin's `userMeta:slack` record as
 * `autoInvite: { status, channelId, channelName, at, error? }` with status
 * 'invited' | 'not_in_workspace' | 'failed'. A user already invited to the
 * current channel is skipped, so a retry never invites twice, and Slack's
 * `already_in_channel` counts as success.
 *
 * The hook waits for the whole invite, including recording the result. On
 * Lambda, work still running after the signup response is sent dies when the
 * container freezes, so nothing is left in the background. Each Slack call
 * gets one 4 s try (slack-client.js), and a timeout is recorded as a
 * retryable failure.
 */
import { db, getUserMeta, putUserMeta } from '../../../src/lib/plugins/sdk.js';

async function freshSettings() {
  return (await db.getSyncData('_system', 'plugins:activation'))?.data?.slack?.settings || null;
}
import { findSlackUserByEmail, inviteToSlackChannel } from './slack-client.js';


/** Whether "Retry all" picks this user up: a recorded result that isn't 'invited'. */
export function needsRetry(meta) {
  return !!meta?.autoInvite && meta.autoInvite.status !== 'invited';
}

export function autoInviteConfigured(settings) {
  return !!(settings?.autoInviteEnabled && settings?.autoInviteChannelId && settings?.botToken);
}

/**
 * Invite one user. `deps` lets tests replace Slack and storage. Returns the
 * recorded result, or null when the feature is off or the user's done.
 */
export async function autoInvite({ userId, email }, settings, deps = {}) {
  const { lookup = findSlackUserByEmail, invite = inviteToSlackChannel, getMeta = getUserMeta, putMeta = putUserMeta } = deps;
  if (!autoInviteConfigured(settings) || !userId || !email) return null;
  const channelId = settings.autoInviteChannelId;
  const meta = (await getMeta(userId, 'slack')) || {};
  if (meta.autoInvite?.status === 'invited' && meta.autoInvite.channelId === channelId) return null;

  let result;
  try {
    const slackUserId = await lookup(settings.botToken, email);
    if (!slackUserId) {
      result = { status: 'not_in_workspace' };
    } else {
      await invite(settings.botToken, channelId, slackUserId);
      result = { status: 'invited' };
    }
  } catch (err) {
    result = { status: 'failed', error: err?.data?.error || err?.message || 'unknown error' };
  }
  const record = { ...result, channelId, channelName: settings.autoInviteChannelName || null, at: new Date().toISOString() };
  await putMeta(userId, 'slack', { ...meta, autoInvite: record });
  return record;
}

/**
 * The `userCreated` hook: never fails signup; waits for the invite to finish.
 * Settings are read fresh: `ctx.settings` is this container's startup
 * snapshot and can miss a channel the admin just changed.
 */
export async function onUserCreated(payload, ctx, { readSettings = freshSettings } = {}) {
  const settings = (await readSettings().catch(() => null)) || ctx?.settings;
  if (!autoInviteConfigured(settings)) return;
  await autoInvite(payload, settings).catch((err) => {
    ctx?.logger?.warn('slack_auto_invite_failed', { error: err?.message });
  });
}
