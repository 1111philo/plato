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
import { splitName } from './names.js';

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
  {
    // #408: today's courses become Units under a new Course level. Put every
    // existing unit in one default Course (admins can rename or split it).
    // Each unit also gets the name-sorted lesson order it already had, so
    // nothing reorders. Only `_system` records change; lessons, progress, and
    // course memory keep their keys. Rollback-safe: Beta-RC-232 ignores
    // program:* records and the extra unit fields.
    id: 'm004_default_program',
    description: 'put existing units (stored course:*) into a default Course',
    async run({ db, dryRun }) {
      const result = { scanned: 0, updated: 0, skipped: 0, errors: 0, notes: [] };
      const items = await db.getAllSyncData('_system');
      const units = items.filter((i) => i.dataKey.startsWith('course:'));
      // Our own prog-default doesn't count: an earlier run that created it and
      // then lost a unit write (or ran out of time) must finish the job.
      const hasProgram = items.some((i) => i.dataKey.startsWith('program:') && i.dataKey !== 'program:prog-default');
      const pending = units.filter((u) => !u.data?.programId);
      result.scanned = units.length;
      if (pending.length === 0) { result.skipped = units.length; return result; }
      if (hasProgram) {
        // Courses an admin created already exist. Leave unassigned units for
        // the admin to place.
        result.skipped = units.length;
        result.notes.push(`${pending.length} unit(s) left unassigned: courses already exist`);
        return result;
      }

      const sortByName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
      const settings = items.find((i) => i.dataKey === 'settings')?.data || {};
      const programId = 'prog-default';
      const unitIds = units.map((u) => ({ id: u.dataKey.slice(7), name: u.data?.name })).sort(sortByName).map((u) => u.id);
      const name = (settings.classroomName || settings.logoAlt || '').trim() || 'Main Course';
      result.notes.push(`create Course "${name}" with ${unitIds.length} unit(s)`);
      if (!dryRun) {
        try {
          await db.createSyncData('_system', `program:${programId}`, {
            name, description: '', unitIds,
            createdBy: 'migration', createdByName: 'migration', createdAt: new Date().toISOString(),
          });
        } catch (err) {
          if (err.name !== 'ConditionalCheckFailedException') throw err; // another container created it
        }
      }

      const lessons = items.filter((i) => i.dataKey.startsWith('lesson:')).map((i) => ({ id: i.dataKey.slice(7), name: i.data?.name, unit: i.data?.course }));
      for (const u of pending) {
        const unitId = u.dataKey.slice(7);
        const lessonIds = u.data?.lessonIds || lessons.filter((l) => l.unit === unitId).sort(sortByName).map((l) => l.id);
        if (dryRun) { result.updated++; continue; }
        try {
          await db.putSyncData('_system', u.dataKey, { ...u.data, programId, lessonIds }, u.version);
          result.updated++;
        } catch (err) {
          // Lost a race with an admin edit: retry on the next cold start.
          if (err.name === 'ConditionalCheckFailedException') result.errors++;
          else throw err;
        }
      }
      result.skipped = units.length - pending.length;
      return result;
    },
  },
  {
    // #402: first and last names. Infer them from the stored `name` by
    // splitting at the first whitespace ("Mary Ann Evans" → "Mary" / "Ann
    // Evans"), marked nameSource 'auto' so the UI can invite a correction.
    // `name` itself is never rewritten. Conditional on `name` being unchanged
    // and no split existing, so a person's own edit always wins. Rollback-safe:
    // Beta-RC-232 reads only `name`.
    id: 'm005_name_split',
    description: 'infer firstName/lastName from the stored name',
    async run({ db, dryRun }) {
      const result = { scanned: 0, updated: 0, skipped: 0, errors: 0, notes: [] };
      let multiPart = 0;
      let empty = 0;
      for (const u of await db.listAllUsers()) {
        result.scanned++;
        if (typeof u.firstName === 'string') { result.skipped++; continue; }
        const { firstName, lastName, parts } = splitName(u.name);
        if (!firstName) { empty++; result.skipped++; continue; }
        if (parts > 2) multiPart++;
        if (dryRun) { result.updated++; continue; }
        try {
          if (await db.setUserNameSplitIf(u.userId, u.name, { firstName, lastName, nameSource: 'auto' })) result.updated++;
          else result.skipped++;
        } catch {
          result.errors++;
        }
      }
      if (multiPart) result.notes.push(`${multiPart} name(s) with 3+ parts: everything after the first word became the last name`);
      if (empty) result.notes.push(`${empty} user(s) with no name: left without a split`);
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
