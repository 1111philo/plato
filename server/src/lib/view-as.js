/**
 * Who a read is for. Normally the signed-in user; with `?asUserId=` (View as
 * User), another user, for roles with `impersonation.use` (admins, testers).
 * The target must be a real user account: `_system` (plugin secrets, wait-list
 * key hash, drafts, email templates) and made-up ids are refused, so View as
 * User can never read anything a learner couldn't.
 */
import db from './db.js';
import { can } from './permissions.js';

export async function resolveReadUserId(c) {
  const asUserId = new URL(c.req.url).searchParams.get('asUserId');
  if (!asUserId) return { userId: c.get('userId'), impersonating: false };
  if (!can(c.get('role'), 'impersonation.use')) {
    return { error: c.json({ error: 'Admin access required to read as another user' }, 403) };
  }
  if (!asUserId.startsWith('usr_') || !(await db.getUserById(asUserId))) {
    return { error: c.json({ error: 'User not found' }, 404) };
  }
  return { userId: asUserId, impersonating: true };
}
