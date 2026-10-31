/**
 * Scheduled learner emails (#400), dispatched as background jobs
 * (lib/jobs.js) when ordinary traffic finds one due (lib/schedule.js). Each one does nothing unless
 * its automation is on (Admin → Notifications → Automations), and honors the
 * learner's opt-out.
 *
 * - **`inactivity-nudge`** (daily): a learner with a lesson they started but
 *   haven't touched in 7 days gets one reminder, for the most recently active
 *   such lesson. The same lesson isn't nudged again for 14 days, and no learner
 *   gets more than one reminder a day.
 * - **`weekly-digest`** (weekly): the learner's past week (lessons completed,
 *   lessons in progress) plus lessons published that week. Skipped when
 *   there's nothing to say, and at most once every 6 days per learner.
 *
 * Learners only, and only lessons they can see. Bookkeeping lives in the
 * learner's server-only `notify:state` (`nudges[lessonId]`, `lastNudgeAt`,
 * `lastDigestAt`), written **before** sending, so a retried job never emails
 * twice.
 */
import defaultDb from './db.js';
import { APP_URL } from '../config.js';
import { normalizeRole } from './permissions.js';
import { normalizeStatus } from './lesson-visibility.js';
import { nameFields } from './names.js';
import { readAutomations, readNotifyState, updateNotifyState, sendTemplated } from './notifications.js';
import { registerJob } from './jobs.js';
import { logger } from './logger.js';

const DAY = 24 * 60 * 60 * 1000;
export const NUDGE_AFTER_DAYS = 7;
export const NUDGE_REPEAT_DAYS = 14;
export const DIGEST_EVERY_DAYS = 6; // weekly, with slack for a late schedule

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Lessons a learner can see: `{ [lessonId]: { name, publishedAt } }`. */
function visibleLessons(systemItems, userId) {
  const out = {};
  for (const i of systemItems) {
    if (!i.dataKey.startsWith('lesson:')) continue;
    const status = normalizeStatus(i.data?.status, !!i.data?.markdown);
    const shared = Array.isArray(i.data?.sharedWith) && i.data.sharedWith.includes(userId);
    if (status === 'public' || (status === 'private' && shared)) {
      out[i.dataKey.slice('lesson:'.length)] = { name: i.data.name, publishedAt: status === 'public' ? i.data.publishedAt || null : null };
    }
  }
  return out;
}

const learners = async (db) => (await db.listAllUsers()).filter((u) => normalizeRole(u.role) === 'learner' && u.email);

/**
 * Write a claim into notify:state with `claim(state) → nextState | null`
 * (null = not eligible). Returns whether this run claimed it.
 */
async function claimFor(userId, claim, db) {
  let claimed = false;
  await updateNotifyState(userId, (st) => {
    const next = claim(st);
    claimed = !!next;
    return next || st;
  }, db);
  return claimed;
}

export async function runInactivityNudges({ db = defaultDb, now = Date.now() } = {}) {
  if (!(await readAutomations(db)).inactivityNudge) return { off: true };
  const counts = { learners: 0, nudged: 0, optedOut: 0, notSent: 0 };
  const system = await db.getAllSyncData('_system');
  for (const u of await learners(db)) {
    counts.learners++;
    const lessons = visibleLessons(system, u.userId);
    // Only lesson progress: the whole partition holds screenshots and conversations.
    const items = await db.getSyncDataByPrefix(u.userId, 'lessonKB:');
    const state = await readNotifyState(u.userId, db);
    if (state.optOut?.nudge) { counts.optedOut++; continue; }
    if (state.lastNudgeAt && now - Date.parse(state.lastNudgeAt) < DAY - 60 * 60 * 1000) continue;
    const stale = items
      .filter((i) => i.dataKey.startsWith('lessonKB:'))
      .map((i) => ({ lessonId: i.dataKey.slice('lessonKB:'.length), kb: i.data || {}, at: Date.parse(i.updatedAt || '') }))
      .filter((l) => lessons[l.lessonId] && l.kb.status !== 'completed' && Number.isFinite(l.at)
        && now - l.at >= NUDGE_AFTER_DAYS * DAY
        && !(state.nudges?.[l.lessonId] && now - Date.parse(state.nudges[l.lessonId]) < NUDGE_REPEAT_DAYS * DAY))
      .sort((a, b) => b.at - a.at);
    const pick = stale[0];
    if (!pick) continue;
    const stamp = new Date(now).toISOString();
    const claimed = await claimFor(u.userId, (st) => {
      if (st.nudges?.[pick.lessonId] && now - Date.parse(st.nudges[pick.lessonId]) < NUDGE_REPEAT_DAYS * DAY) return null;
      return { ...st, lastNudgeAt: stamp, nudges: { ...(st.nudges || {}), [pick.lessonId]: stamp } };
    }, db);
    if (!claimed) continue;
    const r = await sendTemplated('inactivity-nudge', {
      to: u.email, userId: u.userId, kind: 'nudge',
      vars: {
        firstName: nameFields(u).firstName,
        lessonName: lessons[pick.lessonId].name || 'your lesson',
        progress: `${Math.max(0, Math.min(10, Number(pick.kb.progress) || 0)) * 10}%`,
        link: `${APP_URL}/lessons/${encodeURIComponent(pick.lessonId)}`,
      },
    }, { db }).catch(async (err) => {
      // SES refused: release the claim so the next run tries again.
      logger.error('learner_email_failed', { job: 'inactivity-nudge', error: err?.message || String(err) });
      await claimFor(u.userId, (st) => {
        if (st.nudges?.[pick.lessonId] !== stamp) return null;
        const { [pick.lessonId]: _drop, ...nudges } = st.nudges;
        return { ...st, nudges, lastNudgeAt: null };
      }, db).catch(() => {});
      return { failed: true };
    });
    if (r.sent) counts.nudged++; else counts.notSent++;
  }
  return counts;
}

/** The digest's two variable paragraphs, or null when there's nothing to say. */
export function digestContent({ items, lessons, now }) {
  const since = now - 7 * DAY;
  const kbs = items.filter((i) => i.dataKey.startsWith('lessonKB:'))
    .map((i) => ({ lessonId: i.dataKey.slice('lessonKB:'.length), kb: i.data || {}, at: Date.parse(i.updatedAt || '') }))
    .filter((l) => lessons[l.lessonId]);
  const completed = kbs.filter((l) => l.kb.status === 'completed' && Date.parse(l.kb.completedAt || '') >= since);
  // Only lessons touched in the last 30 days: one abandoned lesson shouldn't
  // earn a digest every Monday forever (the inactivity reminder covers it).
  const inProgress = kbs.filter((l) => l.kb.status && l.kb.status !== 'completed' && Number.isFinite(l.at) && now - l.at <= 30 * DAY);
  const fresh = Object.entries(lessons).filter(([, l]) => l.publishedAt && Date.parse(l.publishedAt) >= since);
  if (!completed.length && !inProgress.length && !fresh.length) return null;

  const names = (list) => list.map((l) => lessons[l.lessonId].name).join(', ');
  const progress = [];
  if (completed.length) progress.push(`This week you completed ${plural(completed.length, 'lesson')}: ${names(completed)}.`);
  if (inProgress.length) progress.push(`You have ${plural(inProgress.length, 'lesson')} in progress: ${names(inProgress)}.`);
  if (!progress.length) progress.push('You didn’t work on any lessons this week.');
  const newLessons = fresh.length ? `New this week: ${fresh.map(([, l]) => l.name).join(', ')}.` : '';
  return { progressSummary: progress.join('\n'), newLessons };
}

export async function runWeeklyDigest({ db = defaultDb, now = Date.now() } = {}) {
  if (!(await readAutomations(db)).weeklyDigest) return { off: true };
  const counts = { learners: 0, sent: 0, nothingToSay: 0, optedOut: 0, notSent: 0 };
  const system = await db.getAllSyncData('_system');
  for (const u of await learners(db)) {
    counts.learners++;
    const state = await readNotifyState(u.userId, db);
    if (state.optOut?.digest) { counts.optedOut++; continue; }
    if (state.lastDigestAt && now - Date.parse(state.lastDigestAt) < DIGEST_EVERY_DAYS * DAY) continue;
    const content = digestContent({ items: await db.getSyncDataByPrefix(u.userId, 'lessonKB:'), lessons: visibleLessons(system, u.userId), now });
    if (!content) { counts.nothingToSay++; continue; }
    const stamp = new Date(now).toISOString();
    const claimed = await claimFor(u.userId, (st) => (
      st.lastDigestAt && now - Date.parse(st.lastDigestAt) < DIGEST_EVERY_DAYS * DAY ? null : { ...st, lastDigestAt: stamp }
    ), db);
    if (!claimed) continue;
    const r = await sendTemplated('weekly-digest', {
      to: u.email, userId: u.userId, kind: 'digest',
      vars: { firstName: nameFields(u).firstName, ...content, link: `${APP_URL}/lessons` },
    }, { db }).catch(async (err) => {
      logger.error('learner_email_failed', { job: 'weekly-digest', error: err?.message || String(err) });
      await claimFor(u.userId, (st) => (st.lastDigestAt === stamp ? { ...st, lastDigestAt: null } : null), db).catch(() => {});
      return { failed: true };
    });
    if (r.sent) counts.sent++; else counts.notSent++;
  }
  return counts;
}

registerJob('inactivity-nudge', () => runInactivityNudges());
registerJob('weekly-digest', () => runWeeklyDigest());
