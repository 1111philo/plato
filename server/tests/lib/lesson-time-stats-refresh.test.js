/**
 * The lesson-time-stats refresh claims the record first, so containers that
 * all see it stale at once don't each scan everything (load test 2026-11-10).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshLessonTimeStats, STALE_AFTER_MS, CLAIM_TTL_MS } from '../../src/lib/lesson-time-stats.js';

function fakeDb(initial) {
  let rec = initial ? { version: 1, data: initial } : null;
  let scans = 0;
  const conflictErr = () => Object.assign(new Error('Version mismatch'), { name: 'ConditionalCheckFailedException' });
  return {
    get rec() { return rec; }, get scans() { return scans; },
    async getSyncData() { return rec ? structuredClone(rec) : null; },
    async putSyncData(_u, _k, data, version) {
      if ((rec?.version || 0) !== version) throw conflictErr();
      rec = { version: version + 1, data: structuredClone(data) };
      return { version: rec.version };
    },
    async listAllUsers() { scans++; await new Promise((r) => setTimeout(r, 5)); return [{ userId: 'u1' }]; },
    async getSyncDataByPrefix() { return [1, 2, 3].map((n) => ({ dataKey: 'lessonKB:l1', data: { status: 'completed', activitiesCompleted: n } })); },
  };
}
const T0 = Date.parse('2026-11-11T15:00:00Z');
const clock = (ms) => () => new Date(ms);

describe('lesson time stats refresh', () => {
  it('37 containers at once: one computes, the rest skip without an error', async () => {
    const db = fakeDb({ computedAt: new Date(T0 - STALE_AFTER_MS - 1).toISOString(), byLesson: {} });
    const results = await Promise.all(Array.from({ length: 37 }, () => refreshLessonTimeStats({ db, now: clock(T0) })));
    assert.equal(db.scans, 1);
    assert.equal(results.filter((r) => r.lessons === 1).length, 1);
    assert.ok(results.filter((r) => r.skipped).length === 36);
    assert.deepEqual(db.rec.data.byLesson, { l1: { p20: 1, p80: 3, sampleSize: 3 } });
    assert.equal(db.rec.data.computedAt, new Date(T0).toISOString());
    assert.equal(db.rec.data.refreshingAt, undefined, 'the claim is replaced by the result');
  });

  it('first run (no record) computes', async () => {
    const db = fakeDb(null);
    assert.equal((await refreshLessonTimeStats({ db, now: clock(T0) })).lessons, 1);
  });

  it('skips while fresh or while another refresh is running; an old claim is taken over', async () => {
    const fresh = fakeDb({ computedAt: new Date(T0 - 1000).toISOString(), byLesson: {} });
    assert.deepEqual(await refreshLessonTimeStats({ db: fresh, now: clock(T0) }), { skipped: 'fresh' });
    const stale = new Date(T0 - STALE_AFTER_MS - 1).toISOString();
    const running = fakeDb({ computedAt: stale, byLesson: {}, refreshingAt: new Date(T0 - 1000).toISOString() });
    assert.deepEqual(await refreshLessonTimeStats({ db: running, now: clock(T0) }), { skipped: 'running' });
    const abandoned = fakeDb({ computedAt: stale, byLesson: {}, refreshingAt: new Date(T0 - CLAIM_TTL_MS - 1).toISOString() });
    assert.equal((await refreshLessonTimeStats({ db: abandoned, now: clock(T0) })).lessons, 1);
    assert.equal(fresh.scans + running.scans, 0);
  });

  it('readers keep the old numbers while a refresh is claimed', async () => {
    const db = fakeDb({ computedAt: new Date(T0 - STALE_AFTER_MS - 1).toISOString(), byLesson: { l9: { p20: 2, p80: 5, sampleSize: 4 } } });
    const realList = db.listAllUsers.bind(db);
    let seenDuring;
    db.listAllUsers = async () => { seenDuring = structuredClone(db.rec.data); return realList(); };
    await refreshLessonTimeStats({ db, now: clock(T0) });
    assert.deepEqual(seenDuring.byLesson, { l9: { p20: 2, p80: 5, sampleSize: 4 } });
    assert.ok(seenDuring.refreshingAt);
  });
});
