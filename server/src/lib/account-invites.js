/**
 * Invites for people who already have an account (#363). Someone with an
 * account can still join the wait list; inviting that entry sends them an
 * invite tied to their account (`forUserId`) instead of a signup link. They
 * see it in the classroom and by email, and accepting it merges the entry's
 * answers into their account (`mergeProfile`). Declining discards it.
 *
 * The merge only fills what the account is missing: a group when it has none
 * (and the group still exists), and blank custom fields whose answer is still
 * valid. The name is never copied, and nothing already set is overwritten.
 */
import defaultDb from './db.js';
import { getFieldDefinitions, validateValue } from './user-fields.js';

/** What accepting would change: `{ updates, userGroup, fields }`. Pure. */
export function mergeProfile(user, profile, settings) {
  const updates = {};
  const group = profile?.userGroup;
  if (group && !user.userGroup && (settings.userGroups || []).includes(group)) updates.userGroup = group;
  const fields = [];
  const current = user.customFields || {};
  for (const def of getFieldDefinitions(settings)) {
    const raw = profile?.customFields?.[def.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || current[def.id] || validateValue(def, value)) continue;
    fields.push(def.id);
    (updates.customFields ||= { ...current })[def.id] = value;
  }
  return { updates, userGroup: updates.userGroup || null, fields };
}

const live = (inv) => inv && inv.status === 'pending' && !(inv.ttl && inv.ttl < Math.floor(Date.now() / 1000));

/** The user's pending account invite, or null. */
export async function pendingInviteFor(user, { db = defaultDb } = {}) {
  if (!user?.email) return null;
  const inv = await db.getInviteByEmail(user.email);
  return live(inv) && inv.forUserId === user.userId ? inv : null;
}

/** Accept: merge, then use up the invite. `{ error, status }` when it can't. */
export async function acceptInvite(user, token, { db = defaultDb } = {}) {
  const inv = await db.getInvite(token);
  if (!live(inv) || inv.forUserId !== user.userId) return { error: 'Invite not found', status: 404 };
  const settings = (await db.getSyncData('_system', 'settings'))?.data || {};
  const merged = mergeProfile(user, inv.profile, settings);
  if (Object.keys(merged.updates).length) await db.updateUser(user.userId, merged.updates);
  await db.markInviteUsed(inv.inviteToken);
  await db.createAuditLog({
    action: 'account_invite_accepted', userId: user.userId, performedBy: user.userId,
    details: { inviteToken: inv.inviteToken, invitedBy: inv.invitedBy || null, userGroup: merged.userGroup, fields: merged.fields },
  });
  return { userGroup: merged.userGroup, fields: merged.fields };
}

/** Decline: the invite is discarded and the account is untouched. */
export async function declineInvite(user, token, { db = defaultDb } = {}) {
  const inv = await db.getInvite(token);
  if (!live(inv) || inv.forUserId !== user.userId) return { error: 'Invite not found', status: 404 };
  await db.deleteInvite(inv.inviteToken);
  await db.createAuditLog({ action: 'account_invite_declined', userId: user.userId, performedBy: user.userId, details: { inviteToken: inv.inviteToken } });
  return { ok: true };
}
