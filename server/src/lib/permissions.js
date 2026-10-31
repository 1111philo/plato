/**
 * Roles and permissions (#435). The one place that says who may do what.
 *
 * Roles:
 * - admin: everything.
 * - educator: lessons, courses, and units; view learners and their progress;
 *   invite learners. No Customizer (theme, knowledge base), Plugins, prompts,
 *   settings writes, custom-field or group changes, roles, user edits or
 *   deletion, logs, or View as User.
 * - learner: the classroom only (stored as 'user' before #435; normalizeRole
 *   maps it).
 * - tester: sees every classroom and admin page, changes nothing. Every
 *   `*.read` permission, no write. They may still take lessons themselves:
 *   their own /v1/sync and /v1/me writes aren't admin routes.
 *
 * Enforcement: `authorize` (middleware/authorize.js) looks each /v1/admin/*
 * request up in ROUTE_PERMISSIONS. **A route missing from the table is
 * admin-only**, so a new route is safe by default;
 * tests/lib/permissions.test.js fails if any registered admin route is
 * unmapped. The client mirrors ROLE_PERMISSIONS in
 * client/src/lib/permissions.js (a test compares the two).
 */

export const ROLES = ['admin', 'educator', 'learner', 'tester'];

/** Stored roles from before #435 ('user') and anything unknown read as learner. */
export function normalizeRole(role) {
  if (role === 'user') return 'learner';
  return ROLES.includes(role) ? role : 'learner';
}

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
  // Testers additionally get every '*.read' permission (see can()).
  tester: ['admin.access', 'impersonation.use'],
  learner: [],
};

/** May a user with this (stored) role exercise `permission`? */
export function can(role, permission) {
  const r = normalizeRole(role);
  const perms = ROLE_PERMISSIONS[r] || [];
  if (perms.includes('*') || perms.includes(permission)) return true;
  return r === 'tester' && permission.endsWith('.read');
}

/** Anything not in ROUTE_PERMISSIONS needs this, which only admin ('*') has. */
export const ADMIN_ONLY = 'admin.only';

// [METHOD, path pattern as registered in routes/admin.js, permission]
const R = [
  // Content: lessons and courses
  ['GET', '/v1/admin/lessons', 'content.read'],
  ['GET', '/v1/admin/lessons/:lessonId', 'content.read'],
  ['PUT', '/v1/admin/lessons/:lessonId', 'content.write'],
  ['PUT', '/v1/admin/lessons/:lessonId/conversation', 'content.write'],
  ['DELETE', '/v1/admin/lessons/:lessonId', 'content.write'],
  ['GET', '/v1/admin/bundled-lessons', 'content.read'],
  ['POST', '/v1/admin/bundled-lessons/:lessonId', 'content.write'],
  // Units (stored as course:*); /courses is the pre-#408 alias
  ['GET', '/v1/admin/units', 'content.read'],
  ['GET', '/v1/admin/units/:unitId', 'content.read'],
  ['PUT', '/v1/admin/units/:unitId', 'content.write'],
  ['PUT', '/v1/admin/units/:unitId/order', 'content.write'],
  ['DELETE', '/v1/admin/units/:unitId', 'content.write'],
  ['GET', '/v1/admin/courses', 'content.read'],
  ['GET', '/v1/admin/courses/:courseId', 'content.read'],
  ['PUT', '/v1/admin/courses/:courseId', 'content.write'],
  ['DELETE', '/v1/admin/courses/:courseId', 'content.write'],
  // Courses (stored as program:*)
  ['GET', '/v1/admin/programs', 'content.read'],
  ['GET', '/v1/admin/programs/:programId', 'content.read'],
  ['PUT', '/v1/admin/programs/:programId', 'content.write'],
  ['PUT', '/v1/admin/programs/:programId/order', 'content.write'],
  ['DELETE', '/v1/admin/programs/:programId', 'content.write'],
  // Users
  ['GET', '/v1/admin/users', 'users.read'],
  ['GET', '/v1/admin/users/:userId', 'users.read'],
  ['GET', '/v1/admin/users/:userId/stats', 'users.read'],
  ['PATCH', '/v1/admin/users/:userId', 'users.write'],
  ['DELETE', '/v1/admin/users/:userId', 'users.write'],
  ['POST', '/v1/admin/users/:userId/reset-password', 'users.write'],
  ['PUT', '/v1/admin/users/:userId/role', 'users.role'],
  ['GET', '/v1/admin/stats/lessons', 'stats.read'],
  // Invites
  ['GET', '/v1/admin/invites', 'invites.read'],
  ['POST', '/v1/admin/invites', 'invites.write'],
  ['POST', '/v1/admin/invites/bulk', 'invites.write'],
  ['POST', '/v1/admin/invites/resend', 'invites.write'],
  ['DELETE', '/v1/admin/invites/:token', 'invites.write'],
  ['GET', '/v1/admin/invites/link', 'invites.read'],
  ['POST', '/v1/admin/invites/link', 'invites.write'],
  ['DELETE', '/v1/admin/invites/link', 'invites.write'],
  // Wait list
  ['GET', '/v1/admin/waitlist', 'waitlist.read'],
  ['POST', '/v1/admin/waitlist/:token/invite', 'waitlist.invite'],
  ['POST', '/v1/admin/waitlist/:token/apply', 'users.write'],
  ['PUT', '/v1/admin/waitlist/:token', 'waitlist.write'],
  ['DELETE', '/v1/admin/waitlist/:token', 'waitlist.write'],
  ['PUT', '/v1/admin/waitlist/settings', 'waitlist.write'],
  ['POST', '/v1/admin/waitlist/key', 'waitlist.write'],
  ['DELETE', '/v1/admin/waitlist/key', 'waitlist.write'],
  // Custom user fields and groups
  ['GET', '/v1/admin/user-fields', 'fields.read'],
  ['POST', '/v1/admin/user-fields', 'fields.write'],
  ['PUT', '/v1/admin/user-fields/order', 'fields.write'],
  ['PUT', '/v1/admin/user-fields/:id', 'fields.write'],
  ['DELETE', '/v1/admin/user-fields/:id', 'fields.write'],
  ['PUT', '/v1/admin/groups', 'groups.write'],
  ['DELETE', '/v1/admin/groups/:name', 'groups.write'],
  // Classroom configuration (Customizer)
  ['GET', '/v1/admin/settings', 'settings.read'],
  ['PUT', '/v1/admin/settings', 'settings.write'],
  ['GET', '/v1/admin/theme', 'theme.read'],
  ['PUT', '/v1/admin/theme', 'theme.write'],
  ['GET', '/v1/admin/knowledge-base', 'kb.read'],
  ['PUT', '/v1/admin/knowledge-base', 'kb.write'],
  ['PUT', '/v1/admin/knowledge-base/conversation', 'kb.write'],
  ['GET', '/v1/admin/prompts', 'prompts.read'],
  ['GET', '/v1/admin/prompts/:name', 'prompts.read'],
  ['PUT', '/v1/admin/prompts/:name', 'prompts.write'],
  // Plugins
  ['GET', '/v1/admin/plugins', 'plugins.read'],
  ['PUT', '/v1/admin/plugins/:id/activation', 'plugins.write'],
  ['PUT', '/v1/admin/plugins/:id/settings', 'plugins.write'],
  ['POST', '/v1/admin/plugins/:id/uninstall-data', 'plugins.write'],
  // Notifications
  ['GET', '/v1/admin/notifications', 'notifications.read'],
  ['PUT', '/v1/admin/notifications/automations', 'notifications.write'],
  ['PUT', '/v1/admin/notifications/templates/:id', 'notifications.write'],
  ['DELETE', '/v1/admin/notifications/templates/:id', 'notifications.write'],
  ['POST', '/v1/admin/notifications/templates/:id/test', 'notifications.write'],
  ['POST', '/v1/admin/notifications/preview', 'notifications.read'],
  ['GET', '/v1/admin/notifications/messages', 'notifications.read'],
  ['POST', '/v1/admin/notifications/messages', 'notifications.write'],
  // Observability and audit
  ['GET', '/v1/admin/logs', 'logs.read'],
  ['POST', '/v1/admin/impersonation/start', 'impersonation.use'],
  ['POST', '/v1/admin/impersonation/end', 'impersonation.use'],
];

function toRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
}

// Literal segments must win over params (e.g. /waitlist/key vs /waitlist/:token),
// so match exact paths first, then patterns in table order.
const EXACT = new Map(R.filter(([, p]) => !p.includes(':')).map(([m, p, perm]) => [`${m} ${p}`, perm]));
const PATTERNS = R.filter(([, p]) => p.includes(':')).map(([m, p, perm]) => ({ method: m, re: toRegex(p), perm }));

/** The table as `{ 'METHOD /pattern': permission }` (for tests and docs). */
export const ROUTE_PERMISSIONS = Object.fromEntries(R.map(([m, p, perm]) => [`${m} ${p}`, perm]));

/** The permission a /v1/admin request needs; ADMIN_ONLY when unmapped. */
export function permissionFor(method, path) {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const clean = path.replace(/\/+$/, '') || '/';
  const exact = EXACT.get(`${m} ${clean}`);
  if (exact) return exact;
  const hit = PATTERNS.find((p) => p.method === m && p.re.test(clean));
  return hit ? hit.perm : ADMIN_ONLY;
}
