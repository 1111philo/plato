import { WebClient } from '../../../src/lib/plugins/sdk.js';

/**
 * Create a Slack WebClient for the given bot token.
 */
export function getSlackClient(token, options) {
  return new WebClient(token, apiUrl ? { ...options, slackApiUrl: apiUrl } : options);
}

// Tests point the client at a local fake Slack.
let apiUrl = null;
export function _setSlackApiUrl(url) { apiUrl = url; }

// Auto-invite runs inside signup: one bounded try per call, no retries. A
// rate-limited call fails at once instead of waiting out Slack's retry-after
// (often 30-60 s, past API Gateway's 29 s), which `retries: 0` alone still does.
export const SIGNUP_CALL = { timeout: 4000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true };

// Reading the member list from an admin page: no retries, and a rate-limited
// call fails at once. Left to its defaults the client waits out Slack's
// retry-after (30 s) again and again, and the request hangs until the Lambda
// times out at 120 s (the 2026-11-17 alarm).
export const ADMIN_CALL = { timeout: 10000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true };

/** True when Slack refused the call for rate limiting (HTTP 429). */
export function isSlackRateLimited(err) {
  return err?.code === 'slack_webapi_rate_limited_error' || err?.data?.error === 'ratelimited';
}

// The workspace member list, kept for a minute per bot token. Slack has no
// member search, so every search and every "Slack link" needs the whole list;
// `users.list` allows about 20 calls a minute, which typing in the search box
// used to spend in seconds. Callers that arrive while a read is under way
// share it. Per container, so a few reads a minute at most.
export const MEMBER_CACHE_MS = 60_000;
const memberCache = new Map(); // token -> { at, members } | { pending }
export function _resetMemberCache() { memberCache.clear(); }

export async function listSlackMembers(token, now = Date.now) {
  const hit = memberCache.get(token);
  if (hit?.pending) return hit.pending;
  if (hit && now() - hit.at < MEMBER_CACHE_MS) return hit.members;
  const pending = (async () => {
    const client = getSlackClient(token, ADMIN_CALL);
    const members = [];
    let cursor;
    do {
      const result = await client.users.list({ limit: 200, cursor });
      for (const m of result.members || []) {
        if (m.is_bot || m.deleted || m.id === 'USLACKBOT') continue;
        members.push({
          slackUserId: m.id,
          name: m.real_name || m.name,
          email: m.profile?.email || null,
          avatar: m.profile?.image_48 || null,
        });
      }
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    return members;
  })();
  memberCache.set(token, { pending });
  try {
    const members = await pending;
    memberCache.set(token, { at: now(), members });
    return members;
  } catch (err) {
    // A failed read is never kept, but only this read's own entry is dropped.
    if (memberCache.get(token)?.pending === pending) memberCache.delete(token);
    throw err;
  }
}

/**
 * Validate a bot token by calling auth.test. Returns workspace info on success.
 */
export async function testSlackConnection(token) {
  const client = getSlackClient(token);
  const result = await client.auth.test();
  return { ok: result.ok, team: result.team, teamId: result.team_id, botUserId: result.user_id };
}

/**
 * Search Slack users by name or email. Filters the (cached) member list here:
 * Slack has no server-side user search endpoint.
 */
export async function searchSlackUsers(token, query) {
  const q = (query || '').toLowerCase().trim();
  const members = await listSlackMembers(token);
  if (!q) return members;
  return members.filter(m =>
    (m.name && m.name.toLowerCase().includes(q)) ||
    (m.email && m.email.toLowerCase().includes(q))
  );
}

/**
 * List public channels the bot can see.
 */
export async function listSlackChannels(token) {
  const client = getSlackClient(token);
  const channels = [];
  let cursor;
  do {
    const result = await client.conversations.list({
      types: 'public_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const ch of result.channels || []) {
      channels.push({
        id: ch.id,
        name: ch.name,
        memberCount: ch.num_members || 0,
      });
    }
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return channels;
}

/**
 * List members of a specific channel, returning user info for each.
 */
export async function listChannelMembers(token, channelId) {
  const client = getSlackClient(token);

  // Get member IDs
  const memberIds = [];
  let cursor;
  do {
    const result = await client.conversations.members({ channel: channelId, limit: 200, cursor });
    memberIds.push(...(result.members || []));
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  // Fetch user info for each member
  const members = [];
  for (const id of memberIds) {
    try {
      const { user } = await client.users.info({ user: id });
      if (user.is_bot || user.deleted || user.id === 'USLACKBOT') continue;
      members.push({
        slackUserId: user.id,
        name: user.real_name || user.name,
        email: user.profile?.email || null,
        avatar: user.profile?.image_48 || null,
      });
    } catch {
      // Skip users we can't fetch
    }
  }

  return members;
}

/**
 * Send a DM to a Slack user.
 */
export async function sendSlackDM(token, slackUserId, text) {
  const client = getSlackClient(token);
  const { channel } = await client.conversations.open({ users: slackUserId });
  await client.chat.postMessage({ channel: channel.id, text });
}

/**
 * The workspace member with this email, or null if there's none (Slack's
 * `users_not_found`). Needs the `users:read.email` scope.
 */
export async function findSlackUserByEmail(token, email) {
  try {
    const { user } = await getSlackClient(token, SIGNUP_CALL).users.lookupByEmail({ email });
    return user && !user.deleted ? user.id : null;
  } catch (err) {
    if (err?.data?.error === 'users_not_found') return null;
    throw err;
  }
}

/**
 * Add a workspace member to a channel. Someone already in it counts as done.
 * Needs `channels:manage` (public) or `groups:write` (private), and the bot
 * must be in the channel.
 */
export async function inviteToSlackChannel(token, channelId, slackUserId) {
  try {
    await getSlackClient(token, SIGNUP_CALL).conversations.invite({ channel: channelId, users: slackUserId });
  } catch (err) {
    if (err?.data?.error === 'already_in_channel') return;
    throw err;
  }
}
