/**
 * Invite expiry. An email invite's link stops working INVITE_TTL_DAYS after it's
 * sent, but the invite itself is kept: it carries the person's details (a
 * wait-list invite's name, group, and answers), and deleting it lost anyone who
 * hadn't signed up yet. So email invites store `expiresAt` (epoch seconds), which
 * DynamoDB doesn't act on; an expired one shows as Expired in Admin → Users and
 * Resend gives it a fresh link. Link invites (no person attached) still use
 * DynamoDB's `ttl` and are deleted when they expire. Older invites may only
 * have `ttl`; that counts too (m006 moves pending ones to `expiresAt`).
 */
export function inviteExpiresAt(invite) {
  const at = invite?.expiresAt ?? invite?.ttl;
  return typeof at === 'number' ? at : null;
}

export function inviteExpired(invite, nowMs = Date.now()) {
  const at = inviteExpiresAt(invite);
  return at !== null && at < Math.floor(nowMs / 1000);
}
