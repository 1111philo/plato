/**
 * Client mirror of server/src/lib/permissions.js (#435). It drives
 * navigation and which controls render; the server is what enforces.
 * client/tests/permissions.test.js fails if this map drifts from the
 * server's.
 */
export const ROLES = ['admin', 'educator', 'learner', 'tester'];

export const ROLE_LABELS = { admin: 'Admin', educator: 'Educator', learner: 'Learner', tester: 'Tester' };

export const ROLE_PERMISSIONS = {
  admin: ['*'],
  educator: [
    'admin.access',
    'content.read', 'content.write',
    'users.read', 'stats.read',
    'invites.read', 'invites.write',
    'waitlist.read', 'waitlist.invite',
    'settings.read', 'fields.read', 'theme.read',
  ],
  tester: ['admin.access', 'impersonation.use'],
  learner: [],
};

/** Accounts stored as 'user' before #435 (and cached sessions) read as learner. */
export function normalizeRole(role) {
  if (role === 'user') return 'learner';
  return ROLES.includes(role) ? role : 'learner';
}

/** `can(user, 'content.write')`, where `user` is a user object or a role string. */
export function can(user, permission) {
  const role = normalizeRole(typeof user === 'string' ? user : user?.role);
  const perms = ROLE_PERMISSIONS[role] || [];
  if (perms.includes('*') || perms.includes(permission)) return true;
  return role === 'tester' && permission.endsWith('.read');
}

export const isTester = (user) => normalizeRole(user?.role) === 'tester';
export const roleLabel = (role) => ROLE_LABELS[normalizeRole(role)];
