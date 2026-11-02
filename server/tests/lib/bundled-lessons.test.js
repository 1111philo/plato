/**
 * Bundled lessons (#443, src/lib/bundled-lessons.js): install once, keep
 * unedited copies current, never overwrite edits, never recreate deletions.
 * Runs on the real SQLite backend.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

const DB_PATH = './data/test-bundled-lessons.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db-sqlite.js');
const { ensureBundledLessons, bundledLessonStatus, actOnBundledLesson, versionOf, isStartHere, readBundledMarkdown, BUNDLED_LESSONS, BUNDLED_COURSE } = await import('../../src/lib/bundled-lessons.js');
const { validateLessonMarkdown } = await import('../../src/lib/lesson-markdown.js');

const V1 = '# Getting Started\n\nOrientation.\n\n## Exemplar\n\nA message.\n\n## Learning Objectives\n\n- Can do one\n- Can do two\n';
const V2 = V1.replace('Orientation.', 'Orientation, revised.');
let canonical = V1;
// Only the first lesson unless a test says otherwise (siblings read as missing).
let siblings = null;
const read = (file) => (file === 'getting-started.md' ? canonical : siblings?.[file] ?? null);
const run = () => ensureBundledLessons({ db, read });
const lesson = async () => (await db.getSyncData('_system', 'lesson:getting-started'))?.data;
const admin = { userId: 'usr_admin', username: 'admin' };

async function reset() {
  for (const i of await db.getAllSyncData('_system')) await db.deleteSyncData('_system', i.dataKey);
  canonical = V1;
  siblings = null;
}
after(() => { for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f); });

describe('bundled lessons', () => {
  beforeEach(reset);

  it('ships every real Getting Started lesson with a valid shape', () => {
    for (const b of BUNDLED_LESSONS) {
      const md = readBundledMarkdown(b.file);
      assert.ok(md, b.file);
      assert.equal(validateLessonMarkdown(md), null, b.file);
      assert.match(md, /^## Exemplar$/m, b.file);
      assert.match(md, /^## Coach Directive$/m, b.file);
    }
    assert.match(readBundledMarkdown('getting-started.md'), /^# Welcome to plato$/m);
  });

  it('a brand-new classroom gets it public; a second run changes nothing', async () => {
    assert.deepEqual((await run()).installed, ['getting-started']);
    const l = await lesson();
    assert.equal(l.status, 'public');
    assert.equal(l.name, 'Getting Started');
    assert.equal(l.course, BUNDLED_COURSE.unitId, 'in the Getting Started unit');
    assert.deepEqual(l.bundled, { id: 'getting-started', version: versionOf(V1) });
    assert.ok(isStartHere(l));
    assert.ok(await db.getSyncData('_system', 'bundled:getting-started'), 'install marker');
    const before = await db.getSyncData('_system', 'lesson:getting-started');
    await run();
    assert.equal((await db.getSyncData('_system', 'lesson:getting-started')).version, before.version);
  });

  it('an existing classroom gets it private, with a publish notice', async () => {
    await db.createSyncData('_system', 'lesson:les-1', { name: 'Existing', markdown: V1, status: 'public' });
    await run();
    assert.equal((await lesson()).status, 'private');
    const [s] = await bundledLessonStatus({ db, read });
    assert.equal(s.needsPublish, true);
    await actOnBundledLesson('getting-started', 'dismiss-publish', admin, { db, read });
    assert.equal((await bundledLessonStatus({ db, read }))[0].needsPublish, false);
  });

  it('an unedited copy updates in place, keeping status, unit, and learner progress', async () => {
    await run();
    const cur = await db.getSyncData('_system', 'lesson:getting-started');
    await db.putSyncData('_system', 'lesson:getting-started', { ...cur.data, course: 'course-1', status: 'private' }, cur.version);
    await db.putSyncData('usr_ada', 'lessonKB:getting-started', { progress: 6, status: 'active' }, 0);
    canonical = V2;
    assert.deepEqual((await run()).updated, ['getting-started']);
    const l = await lesson();
    assert.equal(l.markdown, V2);
    assert.equal(l.bundled.version, versionOf(V2));
    assert.deepEqual([l.course, l.status], ['course-1', 'private']);
    assert.equal((await db.getSyncData('usr_ada', 'lessonKB:getting-started')).data.progress, 6);
  });

  it('an edited copy is never overwritten: update available, then dismiss or apply', async () => {
    await run();
    const cur = await db.getSyncData('_system', 'lesson:getting-started');
    await db.putSyncData('_system', 'lesson:getting-started', { ...cur.data, markdown: `${V1}\nLocal note.`, course: 'course-1' }, cur.version);
    canonical = V2;
    assert.deepEqual((await run()).customized, ['getting-started']);
    assert.match((await lesson()).markdown, /Local note/);
    let [s] = await bundledLessonStatus({ db, read });
    assert.deepEqual([s.edited, s.updateAvailable, s.latestMarkdown], [true, true, V2]);

    await actOnBundledLesson('getting-started', 'dismiss', admin, { db, read });
    [s] = await bundledLessonStatus({ db, read });
    assert.equal(s.updateAvailable, false, 'dismissed for this version');

    assert.deepEqual(await actOnBundledLesson('getting-started', 'apply', admin, { db, read }), { ok: true, version: versionOf(V2) });
    const l = await lesson();
    assert.equal(l.markdown, V2);
    assert.equal(l.course, 'course-1', 'unit kept');
    assert.equal(l.bundled.dismissed, undefined, 'dismissal cleared once synced');
    [s] = await bundledLessonStatus({ db, read });
    assert.deepEqual([s.edited, s.updateAvailable], [false, false]);
  });

  it('a deleted copy is never recreated', async () => {
    await run();
    await db.deleteSyncData('_system', 'lesson:getting-started');
    canonical = V2;
    await run();
    assert.equal(await lesson(), undefined);
  });

  it('takes back a copy whose marker an older release dropped, without overwriting it', async () => {
    await run();
    const cur = await db.getSyncData('_system', 'lesson:getting-started');
    const { bundled: _b, ...rolledBack } = cur.data;
    await db.putSyncData('_system', 'lesson:getting-started', { ...rolledBack, markdown: `${V1}\nEdited under RC-232.` }, cur.version);
    canonical = V2;
    await run();
    const l = await lesson();
    assert.equal(l.bundled.id, 'getting-started');
    assert.match(l.markdown, /Edited under RC-232/, 'not overwritten');
    const [st] = await bundledLessonStatus({ db, read });
    assert.equal(st.updateAvailable, true);
  });

  it('a copy an older release only re-saved (same markdown) comes back unedited, with no notice', async () => {
    await run();
    const cur = await db.getSyncData('_system', 'lesson:getting-started');
    const { bundled: _b, ...rolledBack } = cur.data;
    await db.putSyncData('_system', 'lesson:getting-started', { ...rolledBack, status: 'public' }, cur.version);
    const r = await run();
    assert.deepEqual(r.customized, []);
    const [st] = await bundledLessonStatus({ db, read });
    assert.equal(st.edited, false);
    assert.equal(st.updateAvailable, false);
    assert.equal((await lesson()).status, 'public', 'its status is kept');
  });

  it("leaves an admin's own lesson that happens to use the id alone", async () => {
    await db.createSyncData('_system', 'lesson:getting-started', { name: 'Ours', markdown: 'custom', status: 'public' });
    await run();
    const l = await lesson();
    assert.deepEqual([l.name, l.bundled], ['Ours', undefined]);
    assert.equal(isStartHere(l), false);
    assert.deepEqual(await actOnBundledLesson('getting-started', 'apply', admin, { db, read }), { error: 'Not a bundled lesson', status: 404 });
  });

  it('rejects unknown actions', async () => {
    await run();
    assert.equal((await actOnBundledLesson('getting-started', 'nuke', admin, { db, read })).status, 400);
  });
});

describe('the Getting Started course', () => {
  beforeEach(async () => {
    await reset();
    siblings = { 'getting-started-sharing.md': V1.replace('# Getting Started', '# Sharing'), 'getting-started-behind.md': V1.replace('# Getting Started', '# Behind') };
  });
  const get = async (key) => (await db.getSyncData('_system', key))?.data;

  it('installs one course holding one unit with the lessons in order, all public on a new classroom', async () => {
    assert.deepEqual((await run()).installed, BUNDLED_LESSONS.map((b) => b.id));
    const program = await get(`program:${BUNDLED_COURSE.programId}`);
    assert.deepEqual([program.name, program.unitIds, program.bundled], [BUNDLED_COURSE.name, [BUNDLED_COURSE.unitId], { id: BUNDLED_COURSE.id }]);
    const unit = await get(`course:${BUNDLED_COURSE.unitId}`);
    assert.deepEqual([unit.programId, unit.lessonIds], [BUNDLED_COURSE.programId, BUNDLED_LESSONS.map((b) => b.id)]);
    for (const b of BUNDLED_LESSONS) {
      const l = await get(`lesson:${b.id}`);
      assert.deepEqual([l.status, l.course, isStartHere(l)], ['public', BUNDLED_COURSE.unitId, true], b.id);
    }
  });

  it('an install that already had the first lesson: it joins the unit; new lessons follow its status', async () => {
    siblings = null;
    await run(); // the one-lesson release: public, no course yet on that install
    const first = await db.getSyncData('_system', 'lesson:getting-started');
    await db.putSyncData('_system', 'lesson:getting-started', { ...first.data, course: null }, first.version);
    await db.deleteSyncData('_system', `bundled:course:${BUNDLED_COURSE.id}`);
    await db.deleteSyncData('_system', `program:${BUNDLED_COURSE.programId}`);
    await db.deleteSyncData('_system', `course:${BUNDLED_COURSE.unitId}`);
    siblings = { 'getting-started-sharing.md': V1, 'getting-started-behind.md': V1 };
    assert.deepEqual((await run()).installed, ['getting-started-sharing', 'getting-started-behind']);
    assert.equal((await get('lesson:getting-started')).course, BUNDLED_COURSE.unitId);
    assert.equal((await get('lesson:getting-started-sharing')).status, 'public', 'follows the published first lesson');
  });

  it('on an existing classroom everything arrives private', async () => {
    await db.createSyncData('_system', 'lesson:les-1', { name: 'Existing', markdown: V1, status: 'public' });
    await run();
    for (const b of BUNDLED_LESSONS) assert.equal((await get(`lesson:${b.id}`)).status, 'private', b.id);
  });

  it('is the admin\u2019s after install: a deleted course is never recreated, and a placed lesson isn\u2019t moved', async () => {
    await run();
    await db.deleteSyncData('_system', `program:${BUNDLED_COURSE.programId}`);
    const l = await db.getSyncData('_system', 'lesson:getting-started');
    await db.putSyncData('_system', 'lesson:getting-started', { ...l.data, course: 'course-mine' }, l.version);
    await run();
    assert.equal(await get(`program:${BUNDLED_COURSE.programId}`), undefined);
    assert.equal((await get('lesson:getting-started')).course, 'course-mine');
  });

  it('a course the admin already made under the same id is left alone', async () => {
    await db.createSyncData('_system', `program:${BUNDLED_COURSE.programId}`, { name: 'Mine', unitIds: [] });
    await run();
    assert.deepEqual(await get(`program:${BUNDLED_COURSE.programId}`), { name: 'Mine', unitIds: [] });
  });
});
