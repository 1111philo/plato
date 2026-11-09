/**
 * Auto-invite (#379): when someone's plato account is created, add them to
 * the admin's chosen Slack channel, if they're already in the workspace (we
 * match by email; plato doesn't send workspace invitations).
 *
 * The result is kept per user in the plugin's `userMeta:slack` record as
 * `autoInvite: { status, channelId, channelName, slackUserId?, at, error? }`
 * with status 'invited' | 'not_in_workspace' | 'failed'. A user already
 * invited to the current channel is skipped, so a retry never invites twice,
 * and Slack's `already_in_channel` counts as success.
 *
 * When the email matches a workspace member, their Slack id is saved on the
 * plato user (`user.slackUserId`, the "Slack linked" mark in Admin → Users),
 * even if the channel invite then fails. An existing link is kept and used
 * instead of the email lookup. Someone invited before linking existed is
 * picked up by "Retry all", which links them without inviting again.
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


/**
 * Whether "Retry all" picks this user up: a recorded result that isn't
 * 'invited', or an invited user whose plato account isn't linked yet.
 */
export function needsRetry(meta, user) {
  if (!meta?.autoInvite) return false;
  return meta.autoInvite.status !== 'invited' || (!!user && !user.slackUserId);
}

export function autoInviteConfigured(settings) {
  return !!(settings?.autoInviteEnabled && settings?.autoInviteChannelId && settings?.botToken);
}

/**
 * Invite one user. `deps` lets tests replace Slack and storage. Returns the
 * recorded result, or null when the feature is off or the user's done.
 */
export async function autoInvite({ userId, email, slackUserId: linked }, settings, deps = {}) {
  const {
    lookup = findSlackUserByEmail, invite = inviteToSlackChannel, getMeta = getUserMeta, putMeta = putUserMeta,
    getUser = (id) => db.getUserById(id), link = (id, slackUserId) => db.updateUser(id, { slackUserId }),
  } = deps;
  if (!autoInviteConfigured(settings) || !userId || !email) return null;
  const channelId = settings.autoInviteChannelId;
  const meta = (await getMeta(userId, 'slack')) || {};
  if (linked === undefined) linked = (await getUser(userId).catch(() => null))?.slackUserId || null;
  const alreadyInvited = meta.autoInvite?.status === 'invited' && meta.autoInvite.channelId === channelId;
  if (alreadyInvited && linked) return null;

  let result;
  let slackUserId = linked || null;
  try {
    if (!slackUserId) slackUserId = await lookup(settings.botToken, email);
    if (!slackUserId) {
      result = { status: 'not_in_workspace' };
    } else {
      if (!linked) await link(userId, slackUserId);
      if (!alreadyInvited) await invite(settings.botToken, channelId, slackUserId);
      result = { status: 'invited', slackUserId };
    }
  } catch (err) {
    result = { status: 'failed', error: err?.data?.error || err?.message || 'unknown error' };
    if (slackUserId) result.slackUserId = slackUserId;
  }
  // Linking an earlier invite keeps that invite's record and date; if the
  // link fails, the invite still stands.
  if (alreadyInvited) {
    if (result.status !== 'invited') return result;
    const record = { ...meta.autoInvite, slackUserId };
    await putMeta(userId, 'slack', { ...meta, autoInvite: record });
    return record;
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
