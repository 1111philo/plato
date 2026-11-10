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

  it('an SES failure releases the claim, so the next run tries again', async () => {
    await writeAutomations({ inactivityNudge: true }, db);
    setEmailTransport(async () => { throw Object.assign(new Error('AccessDenied'), { name: 'AccessDeniedException' }); });
    const t = Date.now() + 8 * DAY;
    assert.deepEqual([(await runInactivityNudges({ db, now: t })).nudged], [0]);
    setEmailTransport(async (raw) => { mails.push(raw); });
    assert.equal((await runInactivityNudges({ db, now: t })).nudged, 1, 'not stuck for 14 days');
  });

  it('a bounced address is skipped (counted, not failed) and keeps its claim', async () => {
    const supp = await import('../../src/lib/email-suppression.js');
    supp._resetSuppression();
    process.env.SUPPRESSED_EMAILS = 'ada@x.com:BOUNCE';
    try {
      await writeAutomations({ inactivityNudge: true }, db);
      const t = Date.now() + 8 * DAY;
      const r = await runInactivityNudges({ db, now: t });
      assert.deepEqual([r.nudged, r.suppressed, r.errors], [0, 1, 0]);
      assert.equal(mails.length, 0);
      assert.equal((await runInactivityNudges({ db, now: t })).suppressed, 0, 'not retried every run');
    } finally {
      delete process.env.SUPPRESSED_EMAILS;
      supp._resetSuppression();
    }
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

  it('a failed digest send can go out on the next run', async () => {
    await writeAutomations({ weeklyDigest: true }, db);
    setEmailTransport(async () => { throw new Error('SES down'); });
    const t = Date.now() + DAY;
    assert.equal((await runWeeklyDigest({ db, now: t })).sent, 0);
    setEmailTransport(async (raw) => { mails.push(raw); });
    assert.equal((await runWeeklyDigest({ db, now: t })).sent, 1);
  });

  it('an in-progress lesson untouched for 30+ days alone earns no digest', () => {
    const now = Date.now();
    const items = [{ dataKey: 'lessonKB:a', data: { status: 'active' }, updatedAt: new Date(now - 40 * DAY).toISOString() }];
    assert.equal(digestContent({ items, lessons: { a: { name: 'A', publishedAt: null } }, now }), null);
    items[0].updatedAt = new Date(now - 3 * DAY).toISOString();
    assert.match(digestContent({ items, lessons: { a: { name: 'A', publishedAt: null } }, now }).progressSummary, /in progress: A/);
  });

  it('skips a learner with nothing to say', () => {
    assert.equal(digestContent({ items: [], lessons: { a: { name: 'A', publishedAt: null } }, now: Date.now() }), null);
  });
});

// #451 scale review H6: learners in concurrent batches, a time budget, and
// still once per learner.
describe('large classrooms', () => {
  const MANY = 20;
  const ids = Array.from({ length: MANY }, (_, i) => 'usr_m' + i);
  before(async () => {
    for (const [i, id] of ids.entries()) {
      await db.createUser({ userId: id, email: 'm' + i + '@x.com', passwordHash: 'x', name: 'M ' + i, firstName: 'M', lastName: String(i), role: 'learner' });
    }
  });
  beforeEach(async () => {
    for (const id of ids) {
      for (const it of await db.getAllSyncData(id)) await db.deleteSyncData(id, it.dataKey);
      await db.putSyncData(id, 'lessonKB:les-a', { status: 'active', progress: 2 }, 0);
    }
  });
  const recipients = () => mails.map((r) => r.match(/^To: (.*)$/m)[1]);

  it('two overlapping runs still remind each learner once', async () => {
    await writeAutomations({ inactivityNudge: true }, db);
    const t = Date.now() + 8 * DAY;
    const [a, b] = await Promise.all([runInactivityNudges({ db, now: t }), runInactivityNudges({ db, now: t })]);
    assert.equal(a.nudged + b.nudged, MANY + 1, 'every learner (and Ada) once');
    assert.equal(new Set(recipients()).size, recipients().length, 'no address twice');
  });

  it('past the budget a run stops; the next run finishes the rest, with no repeats', async () => {
    await writeAutomations({ weeklyDigest: true }, db);
    const { BATCH_SIZE } = await import('../../src/lib/learner-emails.js');
    let ticks = 0;
    const clock = () => (ticks++ === 0 ? 0 : 10); // past the deadline after the first batch
    const t = Date.now() + 1 * DAY;
    const first = await runWeeklyDigest({ db, now: t, deadline: 5, clock });
    assert.equal(first.learners, BATCH_SIZE);
    assert.ok(first.remaining > 0);
    const second = await runWeeklyDigest({ db, now: t });
    assert.equal(first.sent + second.sent, MANY + 1);
    assert.equal(second.remaining, undefined);
    assert.equal(new Set(recipients()).size, recipients().length, 'no address twice');
  });
});
