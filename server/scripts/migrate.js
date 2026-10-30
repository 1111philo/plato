#!/usr/bin/env node
/**
 * Report (and optionally run) pending data migrations — see src/lib/migrations.js.
 *
 * Read-only by default: prints what each pending migration WOULD change.
 * Migrations run automatically on cold start, so `--apply` is only for
 * rehearsals against a restored copy of prod.
 *
 * Usage (from server/):
 *   # local SQLite dev db
 *   DB_BACKEND=sqlite SQLITE_PATH=./data/plato-dev.db node scripts/migrate.js
 *
 *   # prod DynamoDB, read-only (needs AWS creds; e.g. AWS_PROFILE=dase)
 *   AWS_REGION=us-east-2 node scripts/migrate.js
 *
 *   # rehearsal against restored copies (table names are env-overridable)
 *   USERS_TABLE=plato-rehearsal-users SYNC_DATA_TABLE=plato-rehearsal-sync-data \
 *   INVITES_TABLE=plato-rehearsal-invites ... node scripts/migrate.js --apply
 */
const apply = process.argv.includes('--apply');
const { runMigrations, MIGRATIONS } = await import('../src/lib/migrations.js');
const db = (await import('../src/lib/db.js')).default;

const state = (await db.getSyncData('_system', 'migrations'))?.data || { applied: {} };
console.log(`Backend: ${process.env.DB_BACKEND || 'dynamodb'}  |  mode: ${apply ? 'APPLY' : 'dry run (no writes)'}`);
for (const m of MIGRATIONS) {
  console.log(`  ${state.applied?.[m.id] ? '✓ applied' : '· pending'}  ${m.id} — ${m.description}`);
}

const outcome = await runMigrations({ dryRun: !apply });
if (outcome.skipped) console.log(`\nNothing ran: ${outcome.skipped}`);
for (const { id, result } of outcome.ran) {
  console.log(`\n${id}: scanned ${result.scanned}, ${apply ? 'updated' : 'would update'} ${result.updated}, skipped ${result.skipped}, errors ${result.errors}`);
  for (const note of result.notes || []) console.log(`  - ${note}`);
}
process.exit(outcome.ran.some((r) => r.result.errors > 0) ? 1 : 0);
