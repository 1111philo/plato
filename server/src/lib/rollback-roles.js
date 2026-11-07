/**
 * Roles back to Beta-RC-232's two (#435 rollback): every stored learner,
 * educator, or tester becomes `user`. Used by scripts/rollback-roles.js.
 */
const NEW_ROLES = ['learner', 'educator', 'tester'];

export async function rollbackRoles({ db, apply = false }) {
  const changes = [];
  let failed = 0;
  for (const u of await db.listAllUsers()) {
    if (!NEW_ROLES.includes(u.role)) continue;
    const change = { userId: u.userId, email: u.email, from: u.role };
    if (apply) {
      try {
        change.done = !!(await db.setUserRoleIf(u.userId, u.role, 'user'));
      } catch {
        change.done = false;
      }
      if (!change.done) failed++;
    }
    changes.push(change);
  }
  return { changes, failed };
}
