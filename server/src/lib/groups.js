/**
 * User groups (#434): the names in `_system:settings.userGroups`. A user's
 * membership is the name on their record (`userGroup`); wait-list entries and
 * invites carry it in `profile.userGroup`; a message sent to a group stores
 * it in `audience.group`. So a rename must carry the new name to all of them.
 *
 * Rules:
 * - Names are 1–80 characters and unique **ignoring case**.
 * - The list is kept sorted A–Z, with "None" and "Other" last.
 * - A rename writes the group list first (version-checked), then the
 *   memberships, and reports counts and any failures. A failed membership
 *   write can be retried by renaming again; nothing is lost.
 */
import defaultDb from './db.js';

export const MAX_GROUP_NAME = 80;
const LAST = /^(none|other)$/i;

export function sortGroups(groups) {
  return [...groups].sort((a, b) => (LAST.test(a) - LAST.test(b))
    || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function validateGroupName(name, groups, { except = null } = {}) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return 'Group name is required';
  if (n.length > MAX_GROUP_NAME) return `Group name must be at most ${MAX_GROUP_NAME} characters`;
  if (groups.some((g) => g !== except && same(g, n))) return 'A group with that name already exists';
  return null;
}

/** Version-checked edit of the group list; `change(groups)` returns `{ groups } | { error, status }`. */
async function editGroups(db, change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await db.getSyncData('_system', 'settings');
    const settings = current?.data || {};
    const result = change(settings.userGroups || []);
    if (result.error) return result;
    const userGroups = sortGroups(result.groups);
    try {
      await db.putSyncData('_system', 'settings', { ...settings, userGroups }, current?.version || 0);
      return { userGroups };
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }
  return { error: 'The groups just changed. Try again.', status: 409 };
}

export function addGroup(name, { db = defaultDb } = {}) {
  return editGroups(db, (groups) => {
    const error = validateGroupName(name, groups);
    if (error) return { error, status: error.includes('exists') ? 409 : 400 };
    return { groups: [...groups, name.trim()] };
  });
}

/** Move every membership from `from` to `to` (null clears it). Returns counts. */
async function moveMembers(db, from, to) {
  const counts = { users: 0, invites: 0, messages: 0, failed: 0 };
  const run = async (fn, key) => { try { await fn(); counts[key]++; } catch { counts.failed++; } };
  const [users, invites, system] = await Promise.all([db.listAllUsers(), db.listInvites(), db.getAllSyncData('_system')]);
  await Promise.all([
    ...users.filter((u) => u.userGroup === from).map((u) => run(() => db.updateUser(u.userId, { userGroup: to }), 'users')),
    ...invites.filter((i) => i.profile?.userGroup === from)
      .map((i) => run(() => db.setInviteProfile(i.inviteToken, { ...i.profile, userGroup: to }), 'invites')),
    // Messages already sent to the group keep reaching its members (lib/messages.js
    // matches by name). A deleted group's messages stay addressed to it.
    ...(to ? system.filter((i) => i.dataKey.startsWith('message:') && i.data?.audience?.type === 'group' && i.data.audience.group === from)
      .map((i) => run(() => db.putSyncData('_system', i.dataKey, { ...i.data, audience: { ...i.data.audience, group: to } }, i.version), 'messages')) : []),
  ]);
  return counts;
}

export async function renameGroup(oldName, name, { db = defaultDb } = {}) {
  // Finishing an earlier rename: the list already has the new name and not
  // the old one, but some memberships still carry the old name (a write
  // failed). Just move them.
  const listed = (await db.getSyncData('_system', 'settings'))?.data?.userGroups || [];
  if (!listed.includes(oldName) && listed.includes(name.trim())) {
    return { userGroups: listed, moved: await moveMembers(db, oldName, name.trim()) };
  }
  const result = await editGroups(db, (groups) => {
    if (!groups.includes(oldName)) return { error: 'Group not found', status: 404 };
    const error = validateGroupName(name, groups, { except: oldName });
    if (error) return { error, status: error.includes('exists') ? 409 : 400 };
    return { groups: groups.map((g) => (g === oldName ? name.trim() : g)) };
  });
  if (result.error) return result;
  const moved = name.trim() === oldName ? { users: 0, invites: 0, messages: 0, failed: 0 } : await moveMembers(db, oldName, name.trim());
  return { ...result, moved };
}

export async function deleteGroup(name, { db = defaultDb } = {}) {
  const result = await editGroups(db, (groups) => (
    groups.includes(name) ? { groups: groups.filter((g) => g !== name) } : { error: 'Group not found', status: 404 }
  ));
  if (result.error) return result;
  return { ...result, moved: await moveMembers(db, name, null) };
}
