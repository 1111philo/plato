/**
 * Upgrade-from-Beta-RC-232 gate. Every production install runs RC-232 at the
 * start of the launch sprint; this test proves the full migration set:
 *
 *  1. loses nothing and only touches what a migration declares it may touch,
 *  2. is idempotent (a second run changes nothing), and
 *  3. leaves data that Beta-RC-232's own route handlers still serve correctly
 *     (rollback safety) — checked by extracting server/src at the tag.
 *
 * Every migration PR extends ALLOWED below and adds its own assertions.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = './data/test-upgrade-rc232.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;

const { default: db } = await import('../../src/lib/db-sqlite.js');
const { runMigrations, MIGRATIONS } = await import('../../src/lib/migrations.js');
const { seedRc232, snapshot, diffSnapshots, FIXTURE } = await import('./fixtures/rc232.js');

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_DIR = join(SERVER_DIR, '..');
const RC232_DIR = join(SERVER_DIR, '.rc232');
const TAG = 'Beta-RC-232';

// What the migrations are allowed to add or change, as snapshot-key regexes.
// Anything else differing from the RC-232 fixture fails the test.
const ALLOWED = {
  added: [/^sync:_system:migrations$/],
  // m003_role_learner: users whose stored role was 'user'
  changed: [/^user:usr_(ada|cher|mae|jose|blank|pad)$/],
};
// Learner work is never rewritten by any migration, ever.
const NEVER_TOUCHED = /^sync:usr_[^:]+:(messages|screenshot|lessonKB|courseProgress|lessons):/;

function cleanup() {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f);
}

describe('upgrade from Beta-RC-232', () => {
  let before1;
  let after1;

  before(async () => {
    await seedRc232(db);
    before1 = await snapshot(db);
    const outcome = await runMigrations();
    for (const { id, result } of outcome.ran) assert.equal(result.errors, 0, `${id} reported errors: ${JSON.stringify(result)}`);
    after1 = await snapshot(db);
  });
  after(() => { cleanup(); rmSync(RC232_DIR, { recursive: true, force: true }); });

  it('runs every registered migration exactly once and records it', async () => {
    const state = (await db.getSyncData('_system', 'migrations'))?.data;
    for (const m of MIGRATIONS) assert.ok(state?.applied?.[m.id], `${m.id} recorded as applied`);
    assert.equal(state?.lock ?? null, null, 'lock released');
  });

  it('loses nothing and touches only what migrations declare', () => {
    const { added, removed, changed } = diffSnapshots(before1, after1);
    assert.deepEqual(removed, [], 'no record removed');
    for (const k of added) assert.ok(ALLOWED.added.some((re) => re.test(k)), `unexpected new record ${k}`);
    for (const k of changed) assert.ok(ALLOWED.changed.some((re) => re.test(k)), `unexpected change to ${k}`);
  });

  it("m003_role_learner: every 'user' becomes 'learner'; admins and nothing else change", () => {
    for (const u of FIXTURE.users) {
      const after = JSON.parse(after1[`user:${u.userId}`]);
      const before = JSON.parse(before1[`user:${u.userId}`]);
      assert.equal(after.role, u.role === 'user' ? 'learner' : u.role, u.userId);
      assert.deepEqual({ ...after, role: null }, { ...before, role: null }, `${u.userId}: only the role changed (updatedAt untouched)`);
    }
  });

  it('never rewrites learner work', () => {
    for (const k of Object.keys(before1).filter((key) => NEVER_TOUCHED.test(key))) {
      assert.equal(after1[k], before1[k], `${k} unchanged`);
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    const outcome = await runMigrations();
    assert.equal(outcome.ran.length, 0);
    assert.deepEqual(diffSnapshots(after1, await snapshot(db)), { added: [], removed: [], changed: [] });
  });

  it('Beta-RC-232 route handlers still serve the migrated data (rollback safety)', (t) => {
    const hasTag = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${TAG}^{commit}`], { cwd: REPO_DIR }).status === 0;
    if (!hasTag) {
      // CI fetches the tag (see .github/workflows/test.yml); locally: git fetch --tags
      t.skip(`${TAG} tag not available locally`);
      return;
    }
    rmSync(RC232_DIR, { recursive: true, force: true });
    mkdirSync(RC232_DIR, { recursive: true });
    const archive = execFileSync('git', ['archive', TAG, 'server/src'], { cwd: REPO_DIR, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '--strip-components=1', '-C', RC232_DIR], { input: archive });

    const child = spawnSync(process.execPath, [join(SERVER_DIR, 'tests/migrations/rc232-compat-check.js'), join(RC232_DIR, 'src')], {
      cwd: SERVER_DIR,
      env: { ...process.env, DB_BACKEND: 'sqlite', SQLITE_PATH: DB_PATH, SKIP_EMAIL: 'true' },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.trim().split('\n').filter((l) => l.startsWith('{"results"')).pop();
    const { results } = JSON.parse(line);
    for (const [label, r] of Object.entries(results)) assert.equal(r.status, 200, `RC-232 ${label} → ${r.status}`);

    const publicVisible = FIXTURE.lessons.filter((l) => l.status === 'public').length;
    assert.equal(results['admin users'].count, FIXTURE.users.length);
    assert.equal(results['admin lessons'].count, FIXTURE.lessons.length);
    assert.equal(results['admin courses'].count, FIXTURE.courses.length);
    assert.equal(results['admin waitlist'].count, FIXTURE.waitlist.length);
    assert.equal(results['learner lessons'].count, publicVisible + 1, 'public + the private lesson shared with Ada');
    assert.equal(results['learner kb'].count, 10, "Ada's completed lesson keeps progress 10");
  });
});
