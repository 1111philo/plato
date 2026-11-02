/**
 * Lessons that ship with plato (#443). Today: Getting Started, the learner
 * orientation. The canonical copy is `client/prompts/lessons/<id>.md`
 * (copied into the Lambda bundle with the prompts), and every cold start
 * reconciles each install with it, right after the prompts are seeded:
 *
 * - **First time on an install:** the lesson is created under its fixed id.
 *   A brand-new classroom (no lessons yet) gets it public. An existing
 *   classroom gets it private, and Admin → Lessons asks an admin to publish
 *   it. A `_system:bundled:<id>` marker records the install.
 * - **Deleted by an admin:** never recreated (the marker remains).
 * - **Unedited copy, new version:** updated in place. Status, unit, and
 *   sharing are kept, and learner progress (lessonKB:<id>) is untouched.
 * - **Edited copy, new version:** never overwritten. Admin → Lessons shows
 *   "Update available" with View / Apply / Dismiss.
 *
 * The lesson record carries `bundled: { id, version, dismissed?,
 * publishNoticeDismissed? }`, where `version` is the hash of the canonical
 * markdown the copy was last synced to. The copy counts as edited when its
 * markdown no longer hashes to `version`.
 *
 * The lessons come as one course, **Getting Started with plato** (#443,
 * Blake's review on #451): `BUNDLED_COURSE` is installed once per install
 * (marker `_system:bundled:course:<id>`) as a Course holding one Unit with
 * the lessons in order. After that it's the admin's: renamed, reordered, or
 * deleted, it's never recreated. A bundled lesson installed later joins the
 * unit if it still exists. Learners see the course first (`startHere`).
 * The course record carries `bundled: { id }`, so the default-course
 * migration (m004) doesn't count it as one an admin made.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultDb from './db.js';

export const BUNDLED_LESSONS = Object.freeze([
  { id: 'getting-started', file: 'getting-started.md', startHere: true },
  { id: 'getting-started-sharing', file: 'getting-started-sharing.md', startHere: true },
  { id: 'getting-started-behind', file: 'getting-started-behind.md', startHere: true },
]);

export const BUNDLED_COURSE = Object.freeze({
  id: 'getting-started',
  programId: 'prog-getting-started',
  unitId: 'unit-getting-started',
  name: 'Getting Started with plato',
  unitName: 'How plato works',
});

/**
 * Install the Getting Started course and unit once. Returns the unit id when
 * the unit exists (new or the admin's, still there), else null.
 */
async function ensureBundledCourse(db, now) {
  const c = BUNDLED_COURSE;
  const markerKey = `bundled:course:${c.id}`;
  if (!(await db.getSyncData('_system', markerKey))) {
    const stamp = { createdBy: 'plato', createdByName: 'plato', createdAt: now() };
    const create = async (key, data) => {
      try { await db.createSyncData('_system', key, data); } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err; // exists: another container, or an admin's own
      }
    };
    await create(`program:${c.programId}`, { name: c.name, description: '', unitIds: [c.unitId], bundled: { id: c.id }, ...stamp });
    await create(`course:${c.unitId}`, { name: c.unitName, programId: c.programId, lessonIds: BUNDLED_LESSONS.map((b) => b.id), bundled: { id: c.id }, ...stamp });
    // Bundled lessons installed before the course existed (one lesson, no unit) join it.
    for (const b of BUNDLED_LESSONS) {
      const lesson = await db.getSyncData('_system', `lesson:${b.id}`);
      if (lesson?.data?.bundled && !lesson.data.course) {
        try { await db.putSyncData('_system', `lesson:${b.id}`, { ...lesson.data, course: c.unitId }, lesson.version); } catch (err) {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }
      }
    }
    await create(markerKey, { installedAt: now() });
  }
  return (await db.getSyncData('_system', `course:${c.unitId}`)) ? c.unitId : null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESSONS_DIRS = [
  join(__dirname, '../../client-content/prompts/lessons'), // Lambda build
  join(__dirname, '../../../client/prompts/lessons'), // local dev
];

export function readBundledMarkdown(file) {
  for (const dir of LESSONS_DIRS) {
    const p = join(dir, file);
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return null;
}

export const versionOf = (markdown) => createHash('sha256').update(markdown || '').digest('hex').slice(0, 12);
const titleOf = (markdown, fallback) => (markdown.match(/^# (.+)$/m)?.[1] || fallback).trim();
// The marker after syncing to `version`: its dismissal no longer applies.
// (Built without the key, not `dismissed: undefined`: the DynamoDB document
// client rejects undefined values.)
function synced(meta, version) {
  const { dismissed: _dismissed, ...rest } = meta;
  return { ...rest, version };
}

const bundledById = new Map(BUNDLED_LESSONS.map((b) => [b.id, b]));

/** True when a lesson record is a bundled lesson that should be shown first. */
export function isStartHere(data) {
  return !!(data?.bundled && bundledById.get(data.bundled.id)?.startHere);
}

/**
 * Reconcile every bundled lesson with its canonical copy. Never throws for a
 * single lesson; returns what happened, for the startup log.
 */
export async function ensureBundledLessons({ db = defaultDb, read = readBundledMarkdown, now = () => new Date().toISOString() } = {}) {
  const result = { installed: [], updated: [], customized: [], skipped: [] };
  // Read before anything is installed: a classroom with no lessons yet gets
  // the course public; an existing one gets it private, for an admin to publish.
  const items = await db.getAllSyncData('_system');
  const firstLesson = !items.some((i) => i.dataKey.startsWith('lesson:'));
  let unitId = null;
  try { unitId = await ensureBundledCourse(db, now); } catch (err) {
    console.error('Bundled course failed (non-fatal):', err.message);
  }
  for (const b of BUNDLED_LESSONS) {
    try {
      const markdown = read(b.file);
      if (!markdown) { result.skipped.push(b.id); continue; }
      const version = versionOf(markdown);
      const marker = await db.getSyncData('_system', `bundled:${b.id}`);
      const lesson = await db.getSyncData('_system', `lesson:${b.id}`);

      if (!marker) {
        if (!lesson) {
          // A lesson added to the course later follows the first one: public
          // if an admin already published Getting Started.
          const lead = items.find((i) => i.dataKey === `lesson:${BUNDLED_LESSONS[0].id}`)?.data;
          const leadPublic = !!lead?.bundled && lead.status === 'public';
          try {
            await db.createSyncData('_system', `lesson:${b.id}`, {
              markdown,
              name: titleOf(markdown, b.id),
              status: firstLesson || leadPublic ? 'public' : 'private',
              sharedWith: [],
              course: unitId,
              bundled: { id: b.id, version },
              createdBy: 'plato', createdByName: 'plato', createdAt: now(),
              updatedBy: 'plato', updatedByName: 'plato',
            });
            result.installed.push(b.id);
          } catch (err) {
            if (err.name !== 'ConditionalCheckFailedException') throw err; // another container won
          }
        }
        // An admin's own lesson already using this id is left alone (no `bundled`).
        try {
          await db.createSyncData('_system', `bundled:${b.id}`, { installedAt: now() });
        } catch (err) {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }
        continue;
      }

      if (lesson && !lesson.data?.bundled && lesson.data?.createdBy === 'plato') {
        // Ours, but an older release (a rollback to Beta-RC-232) saved it and
        // dropped the marker. If the markdown is still today's canonical copy
        // (it only changed status, say), it's unedited. Otherwise take it back
        // as an edited copy: never overwritten, and the admin gets "update
        // available".
        const unedited = versionOf(lesson.data.markdown) === version;
        await db.putSyncData('_system', `lesson:${b.id}`, { ...lesson.data, bundled: { id: b.id, version: unedited ? version : 'readopted' } }, lesson.version);
        if (!unedited) result.customized.push(b.id);
        continue;
      }
      if (!lesson || !lesson.data?.bundled) { result.skipped.push(b.id); continue; } // deleted, or not ours
      const current = lesson.data.bundled;
      if (current.version === version) continue;
      if (versionOf(lesson.data.markdown) !== current.version) { result.customized.push(b.id); continue; }
      await db.putSyncData('_system', `lesson:${b.id}`, {
        ...lesson.data,
        markdown,
        // Keep a name the admin changed; follow the new title otherwise.
        name: lesson.data.name && lesson.data.name !== titleOf(lesson.data.markdown, lesson.data.name)
          ? lesson.data.name : titleOf(markdown, lesson.data.name || b.id),
        bundled: synced(current, version),
        updatedBy: 'plato', updatedByName: 'plato',
      }, lesson.version);
      result.updated.push(b.id);
    } catch (err) {
      result.skipped.push(b.id);
      // Two containers starting at once: the other one did it. Not an error.
      if (err.name !== 'ConditionalCheckFailedException') console.error(`Bundled lesson ${b.id} failed (non-fatal):`, err.message);
    }
  }
  return result;
}

/** What Admin → Lessons shows for each installed bundled lesson. */
export async function bundledLessonStatus({ db = defaultDb, read = readBundledMarkdown } = {}) {
  const out = [];
  for (const b of BUNDLED_LESSONS) {
    const lesson = await db.getSyncData('_system', `lesson:${b.id}`);
    const markdown = read(b.file);
    if (!lesson?.data?.bundled || !markdown) continue;
    const latestVersion = versionOf(markdown);
    const meta = lesson.data.bundled;
    const edited = versionOf(lesson.data.markdown) !== meta.version;
    out.push({
      lessonId: b.id,
      name: lesson.data.name,
      status: lesson.data.status,
      edited,
      updateAvailable: meta.version !== latestVersion && meta.dismissed !== latestVersion,
      needsPublish: lesson.data.status === 'private' && !meta.publishNoticeDismissed,
      latestVersion,
      latestMarkdown: markdown,
    });
  }
  return out;
}

/**
 * `action`: 'apply' replaces the copy with the latest canonical markdown
 * (status, unit, and sharing kept); 'dismiss' hides this version's update
 * notice; 'dismiss-publish' hides the "publish it" notice.
 */
export async function actOnBundledLesson(lessonId, action, actor, { db = defaultDb, read = readBundledMarkdown } = {}) {
  const b = bundledById.get(lessonId);
  const lesson = b && await db.getSyncData('_system', `lesson:${lessonId}`);
  if (!lesson?.data?.bundled) return { error: 'Not a bundled lesson', status: 404 };
  const markdown = read(b.file);
  if (!markdown) return { error: 'Bundled copy not found', status: 404 };
  const version = versionOf(markdown);
  const meta = lesson.data.bundled;
  let data;
  if (action === 'apply') {
    data = {
      ...lesson.data,
      markdown,
      name: titleOf(markdown, lesson.data.name || lessonId),
      bundled: synced(meta, version),
      updatedBy: actor.userId, updatedByName: actor.username || actor.email,
    };
  } else if (action === 'dismiss') {
    data = { ...lesson.data, bundled: { ...meta, dismissed: version } };
  } else if (action === 'dismiss-publish') {
    data = { ...lesson.data, bundled: { ...meta, publishNoticeDismissed: true } };
  } else {
    return { error: 'Unknown action', status: 400 };
  }
  await db.putSyncData('_system', `lesson:${lessonId}`, data, lesson.version);
  return { ok: true, version };
}
