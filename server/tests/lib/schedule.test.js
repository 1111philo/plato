/**
 * Traffic-driven schedule for learner emails (#400, src/lib/schedule.js).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runDueJobs, resetScheduleThrottle, CHECK_EVERY_MS } from '../../src/lib/schedule.js';

function fakeDb(automations) {
  const rows = new Map([['_system:automations', { data: automations, version: 1 }]]);
  const conflict = () => Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
  return {
    rows,
    async getSyncData(u, k) { return rows.get(`${u}:${k}`) || null; },
    async putSyncData(u, k, data, v) {
      const cur = rows.get(`${u}:${k}`);
      if ((cur?.version || 0) !== (v || 0)) throw conflict();
      rows.set(`${u}:${k}`, { data, version: (v || 0) + 1 });
    },
  };
}
const at = (iso) => new Date(iso);

describe('schedule', () => {
  let dispatched;
  const dispatch = async (job) => { dispatched.push(job); };
  beforeEach(() => { dispatched = []; resetScheduleThrottle(); });

  it('the daily reminder runs once a day from 15:00 UTC, only when on', async () => {
    const db = fakeDb({ inactivityNudge: true });
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-04T14:59:00Z'), force: true }), []);
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-04T15:01:00Z'), force: true }), ['inactivity-nudge']);
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-04T20:00:00Z'), force: true }), [], 'not twice the same day');
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-05T15:30:00Z'), force: true }), ['inactivity-nudge']);
    assert.deepEqual(await runDueJobs({ db: fakeDb({}), dispatch, now: at('2026-11-05T16:00:00Z'), force: true }), [], 'off: nothing');
  });

  it('the digest runs on Mondays only', async () => {
    const db = fakeDb({ weeklyDigest: true });
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-03T16:00:00Z'), force: true }), [], 'Tuesday');
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-09T16:00:00Z'), force: true }), ['weekly-digest'], 'Monday');
  });

  it('only one container wins the claim', async () => {
    const db = fakeDb({ inactivityNudge: true });
    const real = db.putSyncData;
    let first = true;
    db.putSyncData = async (...a) => { if (first) { first = false; db.rows.set('_system:jobs:schedule', { data: { lastRun: {} }, version: 1 }); } return real(...a); };
    assert.deepEqual(await runDueJobs({ db, dispatch, now: at('2026-11-04T16:00:00Z'), force: true }), []);
    assert.deepEqual(dispatched, []);
  });

  it('a failed dispatch hands the day back for the next check', async () => {
    const db = fakeDb({ inactivityNudge: true });
    const t = at('2026-11-04T16:00:00Z');
    assert.deepEqual(await runDueJobs({ db, dispatch: async () => ({ error: 'throttled' }), now: t, force: true }), []);
    assert.deepEqual(await runDueJobs({ db, dispatch, now: t, force: true }), ['inactivity-nudge']);
  });

  it('checks at most every 10 minutes per container', async () => {
    const db = fakeDb({ inactivityNudge: true });
    const t = at('2026-11-04T16:00:00Z');
    await runDueJobs({ db, dispatch, now: t });
    db.rows.delete('_system:jobs:schedule');
    assert.deepEqual(await runDueJobs({ db, dispatch, now: new Date(t.getTime() + 1000) }), []);
    assert.deepEqual(await runDueJobs({ db, dispatch, now: new Date(t.getTime() + CHECK_EVERY_MS) }), ['inactivity-nudge']);
  });
});
