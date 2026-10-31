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
const { ensureBundledLessons } = await import('../../src/lib/bundled-lessons.js');
const { seedRc232, snapshot, diffSnapshots, FIXTURE } = await import('./fixtures/rc232.js');

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_DIR = join(SERVER_DIR, '..');
const RC232_DIR = join(SERVER_DIR, '.rc232');
const TAG = 'Beta-RC-232';

// What the migrations are allowed to add or change, as snapshot-key regexes.
// Anything else differing from the RC-232 fixture fails the test.
const ALLOWED = {
  added: [
    /^sync:_system:migrations$/,
    /^sync:_system:program:prog-default$/, // m004_default_program
    // Bundled lessons (#443): seeded at startup next to the migrations.
    /^sync:_system:lesson:getting-started$/,
    /^sync:_system:bundled:getting-started$/,
  ],
  changed: [
    /^user:usr_(ada|cher|mae|jose|blank|pad)$/, // m003_role_learner: stored role was 'user'
    /^user:usr_admin$/, // m005_name_split: firstName/lastName added
    /^sync:_system:course:/, // m004: units gain programId + lessonIds
  ],
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
    // Startup also installs bundled lessons; include them so the rollback
    // check below covers them.
    assert.deepEqual((await ensureBundledLessons({ db })).installed, ['getting-started']);
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
      const strip = ({ role, firstName, lastName, nameSource, ...rest }) => rest; // eslint-disable-line no-unused-vars
      assert.deepEqual(strip(after), strip(before), `${u.userId}: only the role (and m005's name parts) changed; updatedAt untouched`);
    }
  });

  it('m004_default_program: one default Course holding every unit, lesson order unchanged', async () => {
    const program = (await db.getSyncData('_system', 'program:prog-default'))?.data;
    assert.equal(program.name, FIXTURE.settings.classroomName);
    assert.deepEqual(program.unitIds, ['course-lead001', 'course-found01'], 'units ordered by name (AI Leadership, Foundations)');
    const found = (await db.getSyncData('_system', 'course:course-found01')).data;
    assert.equal(found.programId, 'prog-default');
    assert.deepEqual(found.lessonIds, ['les-f1', 'les-f2'], 'name order: "Foundations 1" before "Foundations 2"');
    assert.equal(found.name, 'Foundations', 'existing unit fields kept');
    const lead = (await db.getSyncData('_system', 'course:course-lead001')).data;
    assert.deepEqual(lead.lessonIds, ['les-l1', 'les-priv']);
    // Lessons themselves are untouched (membership stays on lesson.course).
    for (const l of FIXTURE.lessons) {
      assert.equal(after1[`sync:_system:lesson:${l.id}`], before1[`sync:_system:lesson:${l.id}`], l.id);
    }
  });

  it('m005_name_split: first/last inferred at the first whitespace; name itself never rewritten', () => {
    const expected = {
      usr_admin: ['Admin', ''],
      usr_ada: ['Ada', 'Lovelace'],
      usr_cher: ['Cher', ''],
      usr_mae: ['Mary', 'Ann Evans'],
      usr_jose: ['José', 'María García López'],
      usr_pad: ['Padded', 'Name'],
    };
    for (const u of FIXTURE.users) {
      const after = JSON.parse(after1[`user:${u.userId}`]);
      assert.equal(after.name, u.name, `${u.userId}: name unchanged`);
      if (expected[u.userId]) {
        assert.deepEqual([after.firstName, after.lastName, after.nameSource], [...expected[u.userId], 'auto'], u.userId);
      } else {
        assert.equal(after.firstName ?? null, null, `${u.userId}: an empty name gets no split`);
      }
    }
  });

  it('Getting Started arrives private on an existing classroom (learners see nothing new until an admin publishes)', async () => {
    const l = (await db.getSyncData('_system', 'lesson:getting-started')).data;
    assert.equal(l.status, 'private');
    assert.deepEqual(l.sharedWith, []);
  });

  it('never rewrites learner work', () => {
    for (const k of Object.keys(before1).filter((key) => NEVER_TOUCHED.test(key))) {
      assert.equal(after1[k], before1[k], `${k} unchanged`);
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    const outcome = await runMigrations();
    assert.equal(outcome.ran.length, 0);
    await ensureBundledLessons({ db });
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
    assert.equal(results['admin lessons'].count, FIXTURE.lessons.length + 1, 'plus the private Getting Started');
    assert.equal(results['admin courses'].count, FIXTURE.courses.length);
    assert.equal(results['admin waitlist'].count, FIXTURE.waitlist.length);
    assert.equal(results['learner lessons'].count, publicVisible + 1, 'public + the private lesson shared with Ada');
    assert.equal(results['learner kb'].count, 10, "Ada's completed lesson keeps progress 10");
  });
});
