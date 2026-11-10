/**
 * Per-lesson completion-time estimates for the Lessons page ("Expected
 * time"): `{ [lessonId]: { p20, p80, sampleSize } }`, the 20th/80th
 * percentile of exchanges among completed lesson KBs, for lessons with at
 * least 3 completions.
 *
 * Computing it reads every learner's `lessonKB:*`, so it never runs from a
 * learner's request (#451 scale review, B2: a cold container used to scan the
 * whole database while the learner waited). The `lesson-time-stats` job
 * computes it and stores `_system:stats:timeStats` = `{ computedAt, byLesson }`;
 * `GET /v1/lessons/time-stats` only reads that record, and asks for a refresh
 * (at most once per container per REFRESH_EVERY_MS) when it's missing or older
 * than STALE_AFTER_MS. Until the first run, learners just see no estimate.
 */
import defaultDb from './db.js';
import { registerJob, dispatchJob } from './jobs.js';

export const STALE_AFTER_MS = 60 * 60 * 1000;
export const REFRESH_EVERY_MS = 10 * 60 * 1000;
export const JOB = 'lesson-time-stats';

export async function computeLessonTimeStats({ db = defaultDb } = {}) {
  const exchangesByLesson = new Map();
  for (const user of await db.listAllUsers()) {
    // Only lesson progress: the partition also holds screenshots and conversations.
    for (const item of await db.getSyncDataByPrefix(user.userId, 'lessonKB:')) {
      const kb = item.data;
      if (kb?.status !== 'completed') continue;
      const exchanges = kb.activitiesCompleted;
      if (typeof exchanges !== 'number' || exchanges <= 0) continue;
      const lessonId = item.dataKey.slice('lessonKB:'.length);
      if (!exchangesByLesson.has(lessonId)) exchangesByLesson.set(lessonId, []);
      exchangesByLesson.get(lessonId).push(exchanges);
    }
  }
  const byLesson = {};
  for (const [lessonId, counts] of exchangesByLesson.entries()) {
    if (counts.length < 3) continue;
    counts.sort((a, b) => a - b);
    const p20Idx = Math.floor(counts.length * 0.2);
    const p80Idx = Math.min(Math.floor(counts.length * 0.8), counts.length - 1);
    byLesson[lessonId] = { p20: counts[p20Idx], p80: counts[p80Idx], sampleSize: counts.length };
  }
  return byLesson;
}

// A refresh claims the record first, so when many containers see it stale at
// once (an event's first minutes) only one computes and the rest skip quietly
// (load test 2026-11-10: 37 started together and 3 logged job_failed on the
// final write). A claim older than CLAIM_TTL_MS is treated as abandoned.
export const CLAIM_TTL_MS = 5 * 60 * 1000;
const conflict = (err) => err?.name === 'ConditionalCheckFailedException';

export async function refreshLessonTimeStats({ db = defaultDb, now = () => new Date() } = {}) {
  const current = await db.getSyncData('_system', 'stats:timeStats');
  const at = now().getTime();
  const computedAt = Date.parse(current?.data?.computedAt || '');
  const claimedAt = Date.parse(current?.data?.refreshingAt || '');
  if (Number.isFinite(computedAt) && at - computedAt <= STALE_AFTER_MS) return { skipped: 'fresh' };
  if (Number.isFinite(claimedAt) && at - claimedAt < CLAIM_TTL_MS) return { skipped: 'running' };
  let version;
  try {
    const claimed = await db.putSyncData('_system', 'stats:timeStats', { ...(current?.data || {}), refreshingAt: new Date(at).toISOString() }, current?.version || 0);
    version = claimed?.version ?? (current?.version || 0) + 1;
  } catch (err) {
    if (conflict(err)) return { skipped: 'claimed' };
    throw err;
  }
  const byLesson = await computeLessonTimeStats({ db });
  try {
    await db.putSyncData('_system', 'stats:timeStats', { computedAt: now().toISOString(), byLesson }, version);
  } catch (err) {
    if (conflict(err)) return { skipped: 'superseded' };
    throw err;
  }
  return { lessons: Object.keys(byLesson).length };
}

registerJob(JOB, () => refreshLessonTimeStats());

let lastAsked = 0;
/** For tests. */
export function _resetTimeStatsRefreshThrottle() { lastAsked = 0; }

/**
 * Ask for a refresh if `record` (the stored `stats:timeStats` item, or null)
 * is missing or stale, at most once per container per REFRESH_EVERY_MS.
 * Fire and forget: never waits on the job.
 */
export function maybeRefreshLessonTimeStats(record, { now = Date.now, dispatch = dispatchJob } = {}) {
  const computedAt = Date.parse(record?.data?.computedAt || '');
  const stale = !Number.isFinite(computedAt) || now() - computedAt > STALE_AFTER_MS;
  if (!stale || (lastAsked && now() - lastAsked < REFRESH_EVERY_MS)) return false;
  lastAsked = now();
  Promise.resolve(dispatch(JOB, {})).catch(() => {});
  return true;
}
