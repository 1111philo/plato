/**
 * Data migrations: run once per install, automatically, on cold start.
 *
 * Every production install upgrades from Beta-RC-232 on its own (self-hosted
 * ones included), so migrations must be safe without an operator:
 *
 * - **Additive & idempotent.** A migration only adds fields or records, or
 *   changes a value that still holds the exact old value it expects
 *   (conditional per-item writes). Running it twice changes nothing.
 * - **Rollback-compatible.** Beta-RC-232 code must keep working on migrated
 *   data — that's the bar `tests/migrations/upgrade-from-rc232.test.js`
 *   enforces against the real RC-232 route handlers.
 * - **Never blocks serving.** Failures are logged; an item that fails is
 *   retried on the next cold start because the migration isn't recorded as
 *   applied until it finishes with zero errors.
 *
 * State lives in `_system:migrations` = `{ applied: { [id]: { at, result } },
 * lock: { owner, until } | null }`. The lock (optimistic-versioned write)
 * keeps concurrent Lambda containers from running the same migration at once.
 *
 * A migration is `{ id, description, run({ db, dryRun, log }) → result }`,
 * where `result = { scanned, updated, skipped, errors, notes? }`. In dry-run
 * mode it must not write — it reports what it *would* change.
 */

import defaultDb from './db.js';
import { logger } from './logger.js';

const STATE_KEY = 'migrations';
const LOCK_TTL_MS = 5 * 60 * 1000;

// Ordered registry. Append only — never reorder or remove an entry that may
// already be recorded as applied on some install.
export const MIGRATIONS = [
  {
    // #435: the 'user' role is renamed 'learner'. normalizeRole() already
    // reads 'user' as learner, so this only tidies stored data; code doesn't
    // depend on it running. Rollback-safe: Beta-RC-232 treats any non-'admin'
    // role as a regular user.
    id: 'm003_role_learner',
    description: "rename stored role 'user' to 'learner'",
    async run({ db, dryRun }) {
      const result = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
      for (const u of await db.listAllUsers()) {
        result.scanned++;
        if (u.role !== 'user') { result.skipped++; continue; }
        if (dryRun) { result.updated++; continue; }
        try {
          if (await db.setUserRoleIf(u.userId, 'user', 'learner')) result.updated++;
          else result.skipped++;
        } catch {
          result.errors++;
        }
      }
      return result;
    },
  },
];

function emptyResult() {
  return { scanned: 0, updated: 0, skipped: 0, errors: 0 };
}

async function readState(db) {
  const item = await db.getSyncData('_system', STATE_KEY);
  return { item, state: { applied: {}, lock: null, ...(item?.data || {}) } };
}

// Write state guarded by the version we read; returns false on a lost race.
async function writeState(db, item, state) {
  try {
    if (item) await db.putSyncData('_system', STATE_KEY, state, item.version);
    else await db.createSyncData('_system', STATE_KEY, state);
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/**
 * Run every pending migration. Returns `{ ran: [{ id, result }], skipped }`
 * where `skipped` is a reason string when nothing ran (locked / lost race).
 *
 * Options: `dryRun` (no writes at all, not even the lock), `migrations`
 * (override the registry — tests), `db`, `owner`, `now`.
 */
export async function runMigrations({
  dryRun = false,
  migrations = MIGRATIONS,
  db = defaultDb,
  owner = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  now = () => Date.now(),
} = {}) {
  let { item, state } = await readState(db);
  const pending = migrations.filter((m) => !state.applied[m.id]);
  if (pending.length === 0) return { ran: [], skipped: 'none_pending' };

  if (dryRun) {
    const ran = [];
    for (const m of pending) {
      const result = await runOne(m, { db, dryRun: true });
      ran.push({ id: m.id, result });
    }
    return { ran, skipped: null };
  }

  // Acquire the lock (or skip: another container is migrating right now).
  if (state.lock && state.lock.until > now()) return { ran: [], skipped: 'locked' };
  state = { ...state, lock: { owner, until: now() + LOCK_TTL_MS } };
  if (!(await writeState(db, item, state))) return { ran: [], skipped: 'lost_race' };

  const ran = [];
  try {
    for (const m of pending) {
      const result = await runOne(m, { db, dryRun: false });
      ran.push({ id: m.id, result });
      if (result.errors === 0) {
        // Re-read so the version is current, then record it as applied.
        ({ item, state } = await readState(db));
        state.applied = { ...state.applied, [m.id]: { at: new Date(now()).toISOString(), result } };
        await writeState(db, item, state);
      }
    }
  } finally {
    ({ item, state } = await readState(db));
    if (state.lock?.owner === owner) await writeState(db, item, { ...state, lock: null });
  }
  return { ran, skipped: null };
}

const STARTUP_BUDGET_MS = 20_000;

/** Startup entry point: never throws, never waits longer than the budget. */
export async function runMigrationsBounded({ budgetMs = STARTUP_BUDGET_MS, ...opts } = {}) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), budgetMs); });
  try {
    const outcome = await Promise.race([runMigrations(opts), timeout]);
    if (outcome === 'timeout') logger.warn('migrations_startup_budget_exceeded', { budgetMs });
    return outcome;
  } catch (err) {
    logger.error('migrations_failed', { error: err?.message, stack: err?.stack });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runOne(m, { db, dryRun }) {
  const log = (event, fields) => logger.warn(event, { migration: m.id, dryRun, ...fields });
  let result;
  try {
    result = { ...emptyResult(), ...(await m.run({ db, dryRun, log })) };
  } catch (err) {
    result = { ...emptyResult(), errors: 1, fatal: err?.message || String(err) };
  }
  // Tier 1 (OBSERVABILITY.md): visible in CloudWatch / GET /v1/admin/logs.
  if (result.errors > 0) logger.error('migration_failed', { migration: m.id, dryRun, ...result });
  else logger.warn('migration_applied', { migration: m.id, dryRun, ...result });
  return result;
}
