import { can, permissionFor } from '../lib/permissions.js';

/**
 * /v1/admin/* authorization (#435). Run after `authenticate`, which loads the
 * user's role fresh from the DB on every request (so a role change applies on
 * the next request). The route→permission table lives in lib/permissions.js;
 * an unmapped route is admin-only.
 */
export async function authorize(c, next) {
  const permission = permissionFor(c.req.method, c.req.path);
  if (!can(c.get('role'), permission)) {
    return c.json({ error: 'You do not have permission to do that', code: 'forbidden', permission }, 403);
  }
  c.set('permission', permission);
  await next();
}
