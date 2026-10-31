#!/usr/bin/env node
/**
 * After redeploying Beta-RC-232: put stored roles back into the two it knows.
 * `learner`, `educator`, and `tester` all become `user` (RC-232 treats every
 * non-admin the same way); admins are untouched. Each write is conditional on
 * the role still being what was read, so it's safe to run twice. See
 * docs/RELEASE_NOTES_launch.md, "If you need to roll back".
 *
 * Read-only by default: prints what it WOULD change. Add --apply to write.
 *
 * Usage (from server/):
 *   AWS_PROFILE=dase AWS_REGION=us-east-2 node scripts/rollback-roles.js            # prod, dry run
 *   AWS_PROFILE=dase AWS_REGION=us-east-2 node scripts/rollback-roles.js --apply
 *   USERS_TABLE=plato-playground-users ... node scripts/rollback-roles.js           # another stack
 *   DB_BACKEND=sqlite SQLITE_PATH=./data/plato-dev.db node scripts/rollback-roles.js --apply
 */
import { rollbackRoles } from '../src/lib/rollback-roles.js';

const apply = process.argv.includes('--apply');
const db = (await import('../src/lib/db.js')).default;
console.log(`Backend: ${process.env.DB_BACKEND || 'dynamodb'}  |  mode: ${apply ? 'APPLY' : 'dry run (no writes)'}`);
const r = await rollbackRoles({ db, apply });
for (const c of r.changes) console.log(`  ${c.email || c.userId}: ${c.from} -> user${c.done === false ? '  (FAILED: changed meanwhile, or write error)' : ''}`);
console.log(`\n${r.changes.length} ${apply ? 'changed' : 'would change'}; ${r.failed} failed.`);
if (r.changes.some((c) => c.from !== 'learner')) {
  console.log('Educators and testers are now ordinary users. Make any who need admin access during the rollback admins in Admin -> Users.');
}
process.exit(r.failed ? 1 : 0);
