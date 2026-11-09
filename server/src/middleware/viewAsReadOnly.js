/**
 * Admin "View as User" is read-only, enforced server-side for every route.
 *
 * While an admin is viewing as a learner, the client sends
 * `X-Plato-View-As: <targetUserId>` on every request (client/js/auth.js
 * authenticatedFetch). Any write carrying it is rejected here, before routing.
 * Writes never carry `?asUserId=`, so the per-route guard in sync.js never
 * fired; a stray write during a session would have landed on the admin's own
 * records.
 *
 * This guards against client bugs. It isn't a security boundary: an admin
 * who omits the header is just writing their own data.
 */
export const VIEW_AS_HEADER = 'x-plato-view-as';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// What an admin must still be able to do mid-session: leave it, keep the
// session alive, or sign out.
const ALLOWED_WRITES = new Set([
  'POST /v1/admin/impersonation/end',
  'POST /v1/auth/refresh',
  'POST /v1/auth/logout',
]);

export async function viewAsReadOnly(c, next) {
  if (!c.req.header(VIEW_AS_HEADER)) return next();
  const method = c.req.method.toUpperCase();
  if (SAFE_METHODS.has(method) || ALLOWED_WRITES.has(`${method} ${c.req.path}`)) return next();
  return c.json({ error: 'Changes are not allowed while viewing as another user', code: 'view_as_read_only' }, 403);
}
