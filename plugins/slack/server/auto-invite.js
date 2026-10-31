/**
 * Auto-invite (#379): when someone's plato account is created, add them to
 * the admin's chosen Slack channel, if they're already in the workspace (we
 * match by email; plato doesn't send workspace invitations).
 *
 * The result is kept per user in the plugin's `userMeta:slack` record as
 * `autoInvite: { status, channelId, channelName, at, error? }` with status
 * 'invited' | 'not_in_workspace' | 'failed'. A user already invited to the
 * current channel is skipped, so a retry never invites twice, and Slack's
 * `already_in_channel` counts as success. Signup waits at most
 * SIGNUP_WAIT_MS; slower work finishes and records its result afterwards.
 */
import { getUserMeta, putUserMeta } from '../../../src/lib/plugins/sdk.js';
import { findSlackUserByEmail, inviteToSlackChannel } from './slack-client.js';

export const SIGNUP_WAIT_MS = 3000;

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

/** The `userCreated` hook: never fails or holds up signup for long. */
export async function onUserCreated(payload, ctx) {
  if (!autoInviteConfigured(ctx?.settings)) return;
  const work = autoInvite(payload, ctx.settings).catch((err) => {
    ctx?.logger?.warn('slack_auto_invite_failed', { error: err?.message });
  });
  await Promise.race([work, new Promise((r) => setTimeout(r, SIGNUP_WAIT_MS))]);
}
