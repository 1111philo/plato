/**
 * When the scheduled learner emails run (#400). There's no EventBridge rule:
 * creating one needs `events:*` on the deploy role, which installs following
 * docs/DEPLOY.md don't have (playground's deploy failed on exactly that).
 * Instead, ordinary traffic checks the clock: at most every CHECK_EVERY_MS per
 * container, `runDueJobs()` looks at `_system:jobs:schedule` and, for each
 * job whose time has come and that hasn't run for this period, claims it with
 * a version-checked write (so only one container wins), then dispatches it as
 * a background job (lib/jobs.js). A job whose automation is off isn't claimed.
 *
 * Schedules (UTC):
 * - inactivity-nudge: daily, from 15:00
 * - weekly-digest: Mondays, from 15:00
 * A classroom with no traffic at all that day sends nothing, which is fine for
 * reminders about using it.
 */
import defaultDb from './db.js';
import { readAutomations } from './notifications.js';
import { dispatchJob } from './jobs.js';

export const CHECK_EVERY_MS = 10 * 60 * 1000;
const HOUR = 15;

const day = (d) => d.toISOString().slice(0, 10);

export const SCHEDULES = Object.freeze([
  {
    job: 'inactivity-nudge',
    automation: 'inactivityNudge',
    // The period key: today's date once it's past 15:00 UTC.
    period: (d) => (d.getUTCHours() >= HOUR ? day(d) : null),
  },
  {
    job: 'weekly-digest',
    automation: 'weeklyDigest',
    period: (d) => (d.getUTCDay() === 1 && d.getUTCHours() >= HOUR ? day(d) : null),
  },
]);

let lastCheck = 0;

/** For tests: forget the per-container throttle. */
export function resetScheduleThrottle() {
  lastCheck = 0;
}

/**
 * Claim and dispatch every job that's due. Returns the jobs dispatched.
 * Cheap when nothing's due: one read every CHECK_EVERY_MS per container.
 */
export async function runDueJobs({ db = defaultDb, now = new Date(), dispatch = dispatchJob, force = false } = {}) {
  if (!force && now.getTime() - lastCheck < CHECK_EVERY_MS) return [];
  lastCheck = now.getTime();
  const due = SCHEDULES.map((s) => ({ ...s, key: s.period(now) })).filter((s) => s.key);
  if (!due.length) return [];
  const item = await db.getSyncData('_system', 'jobs:schedule');
  const lastRun = item?.data?.lastRun || {};
  const pending = due.filter((s) => lastRun[s.job] !== s.key);
  if (!pending.length) return [];
  const automations = await readAutomations(db);
  const toRun = pending.filter((s) => automations[s.automation]);
  if (!toRun.length) return [];
  try {
    await db.putSyncData('_system', 'jobs:schedule', {
      lastRun: { ...lastRun, ...Object.fromEntries(toRun.map((s) => [s.job, s.key])) },
    }, item?.version || 0);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return []; // another container claimed it
    throw err;
  }
  for (const s of toRun) await dispatch(s.job, {});
  return toRun.map((s) => s.job);
}
