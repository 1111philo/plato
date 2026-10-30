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
const { ensureBundledLessons, bundledLessonStatus, actOnBundledLesson, versionOf, isStartHere, readBundledMarkdown } = await import('../../src/lib/bundled-lessons.js');

const V1 = '# Getting Started\n\nOrientation.\n\n## Exemplar\n\nA message.\n\n## Learning Objectives\n\n- Can do one\n- Can do two\n';
const V2 = V1.replace('Orientation.', 'Orientation, revised.');
let canonical = V1;
const read = () => canonical;
const run = () => ensureBundledLessons({ db, read });
const lesson = async () => (await db.getSyncData('_system', 'lesson:getting-started'))?.data;
const admin = { userId: 'usr_admin', username: 'admin' };

async function reset() {
  for (const i of await db.getAllSyncData('_system')) await db.deleteSyncData('_system', i.dataKey);
  canonical = V1;
}
after(() => { for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f); });

describe('bundled lessons', () => {
  beforeEach(reset);

  it('ships the real Getting Started file with a valid shape', () => {
    const md = readBundledMarkdown('getting-started.md');
    assert.match(md, /^# Getting Started$/m);
    const objectives = md.split(/^## Learning Objectives$/m)[1].split(/^## /m)[0].match(/^- Can .+/gm);
    assert.ok(objectives.length >= 2 && objectives.length <= 4, `${objectives.length} objectives`);
    assert.match(md, /^## Coach Directive$/m);
  });

  it('a brand-new classroom gets it public; a second run changes nothing', async () => {
    assert.deepEqual((await run()).installed, ['getting-started']);
    const l = await lesson();
    assert.equal(l.status, 'public');
    assert.equal(l.name, 'Getting Started');
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
