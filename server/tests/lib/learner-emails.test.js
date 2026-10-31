/**
 * Scheduled learner emails (#400, src/lib/learner-emails.js) on real SQLite.
 * Records are written "now"; the jobs run with a later `now`.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

const DB_PATH = './data/test-learner-emails.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db-sqlite.js');
const { runInactivityNudges, runWeeklyDigest, digestContent } = await import('../../src/lib/learner-emails.js');
const { setEmailTransport, setOptOut, writeAutomations } = await import('../../src/lib/notifications.js');

const DAY = 86400000;
const mails = [];
const subjects = () => mails.map((r) => r.match(/^Subject: (.*)$/m)[1]);
const bodyOf = (raw) => Buffer.from(raw.match(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

before(async () => {
  setEmailTransport(async (raw) => { mails.push(raw); });
  await db.createUser({ userId: 'usr_ada', email: 'ada@x.com', passwordHash: 'x', name: 'Ada King', firstName: 'Ada', lastName: 'King', role: 'learner' });
  await db.createUser({ userId: 'usr_ed', email: 'ed@x.com', passwordHash: 'x', name: 'Ed', firstName: 'Ed', lastName: '', role: 'educator' });
});
after(() => {
  setEmailTransport(null);
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f);
});
beforeEach(async () => {
  mails.length = 0;
  for (const owner of ['_system', 'usr_ada', 'usr_ed']) for (const i of await db.getAllSyncData(owner)) await db.deleteSyncData(owner, i.dataKey);
  await db.putSyncData('_system', 'lesson:les-a', { name: 'Values', markdown: '# Values', status: 'public' }, 0);
  await db.putSyncData('_system', 'lesson:les-b', { name: 'Prompts', markdown: '# Prompts', status: 'public', publishedAt: new Date().toISOString() }, 0);
  await db.putSyncData('_system', 'lesson:les-p', { name: 'Hidden', markdown: '# Hidden', status: 'private', sharedWith: [] }, 0);
  await db.putSyncData('usr_ada', 'lessonKB:les-a', { status: 'active', progress: 6 }, 0);
  await db.putSyncData('usr_ed', 'lessonKB:les-a', { status: 'active', progress: 1 }, 0);
});

describe('inactivity nudge', () => {
  it('does nothing while the automation is off', async () => {
    assert.deepEqual(await runInactivityNudges({ db, now: Date.now() + 8 * DAY }), { off: true });
    assert.equal(mails.length, 0);
  });

  it('after 7 quiet days, reminds learners (not staff) once, then not again for 14 days', async () => {
    await writeAutomations({ inactivityNudge: true }, db);
    assert.equal((await runInactivityNudges({ db, now: Date.now() + 6 * DAY })).nudged, 0, 'too soon');
    const t = Date.now() + 8 * DAY;
    assert.equal((await runInactivityNudges({ db, now: t })).nudged, 1);
    assert.deepEqual(subjects(), ['Pick up where you left off: Values']);
    assert.match(mails[0], /^To: ada@x\.com$/m);
    assert.match(bodyOf(mails[0]), /you're 60% of the way there/);
    assert.match(bodyOf(mails[0]), /\/lessons\/les-a/);
    assert.equal((await runInactivityNudges({ db, now: t })).nudged, 0, 'a retried run sends nothing');
    assert.equal((await runInactivityNudges({ db, now: t + 10 * DAY })).nudged, 0, 'same lesson within 14 days');
    assert.equal((await runInactivityNudges({ db, now: t + 15 * DAY })).nudged, 1);
  });

  it('skips completed lessons, lessons they can’t see, and opted-out learners', async () => {
    await writeAutomations({ inactivityNudge: true }, db);
    await db.putSyncData('usr_ada', 'lessonKB:les-a', { status: 'completed', progress: 10 }, 1);
    await db.putSyncData('usr_ada', 'lessonKB:les-p', { status: 'active', progress: 2 }, 0);
    assert.equal((await runInactivityNudges({ db, now: Date.now() + 8 * DAY })).nudged, 0);
    await db.putSyncData('usr_ada', 'lessonKB:les-a', { status: 'active', progress: 3 }, 2);
    await setOptOut('usr_ada', { nudge: true }, db);
    const r = await runInactivityNudges({ db, now: Date.now() + 8 * DAY });
    assert.deepEqual([r.nudged, r.optedOut], [0, 1]);
  });
});

describe('weekly digest', () => {
  it('summarizes progress and new lessons, once per week, honoring the opt-out', async () => {
    await writeAutomations({ weeklyDigest: true }, db);
    await db.putSyncData('usr_ada', 'lessonKB:les-b', { status: 'completed', progress: 10, completedAt: new Date().toISOString() }, 0);
    const t = Date.now() + DAY;
    assert.equal((await runWeeklyDigest({ db, now: t })).sent, 1);
    const text = bodyOf(mails[0]);
    assert.match(text, /This week you completed 1 lesson: Prompts\./);
    assert.match(text, /You have 1 lesson in progress: Values\./);
    assert.match(text, /New this week: Prompts\./);
    assert.doesNotMatch(text, /Hidden/);
    assert.match(mails[0], /^List-Unsubscribe: </m);
    assert.equal((await runWeeklyDigest({ db, now: t + DAY })).sent, 0, 'not twice in a week');
    await setOptOut('usr_ada', { digest: true }, db);
    assert.equal((await runWeeklyDigest({ db, now: t + 8 * DAY })).optedOut, 1);
  });

  it('skips a learner with nothing to say', () => {
    assert.equal(digestContent({ items: [], lessons: { a: { name: 'A', publishedAt: null } }, now: Date.now() }), null);
  });
});
