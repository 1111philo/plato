/**
 * Sequential course-progress update queue — mirrors profileQueue. Keeps the
 * per-course distilled summary up to date as the learner completes lessons,
 * without overlapping writes racing each other.
 *
 * The summary is regenerated incrementally (prior summary + the one
 * just-completed lesson) so both the agent's input and the stored note stay
 * small — it is injected into the coach context on every turn of every other
 * lesson in the course (see lessonEngine.buildContext).
 */

import { getCourseProgress, saveCourseProgress } from '../../js/storage.js';
import { getLessonsInCourse } from '../../js/lessonOwner.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncIfUnsaved } from './syncDebounce.js';

let _courseProgressQueue = Promise.resolve();

/**
 * Merge the completed-lesson ids for a course after a completion. Completions
 * are monotonic — a lesson never becomes "uncompleted" — so this unions the
 * prior ids, whatever the agent returned, and the just-completed lesson, then
 * dedupes. It can only grow the set: a prior id is never lost, and the client
 * owns the bookkeeping — the `course-progress-update` agent no longer returns
 * ids (it can't see the just-completed lesson's id), so `returnedIds` is
 * normally undefined and is purely defensive: an agent that returns an
 * empty/partial/malformed array can't shrink the set. This replaces
 * `result.completedLessonIds || prior`, which dropped prior ids when the agent
 * returned `[]` — the empty array is itself truthy, so `||` short-circuited to
 * it. Exported for unit testing.
 */
export function mergeCompletedLessonIds(priorIds, returnedIds, lessonId) {
  return [...new Set([
    ...(Array.isArray(priorIds) ? priorIds : []),
    ...(Array.isArray(returnedIds) ? returnedIds : []),
    ...(lessonId ? [lessonId] : []),
  ])];
}

export function queueCourseProgressUpdate(fn) {
  _courseProgressQueue = _courseProgressQueue.then(fn).catch(e => {
    console.error('[plato] Course progress update failed:', e?.message || e, e?.stack);
  });
  return _courseProgressQueue;
}

/**
 * Regenerate the course-progress summary after a lesson completes.
 * No-op unless the lesson belongs to a course.
 * @param {object} lessonKB - the completed lesson's KB (learnerPosition, insights)
 * @param {object} lesson - the lesson (lessonId, name, course: { id, name })
 */
export function updateCourseProgressOnCompletionInBackground(lessonKB, lesson) {
  const courseId = lesson?.course?.id;
  // No-op for standalone lessons; the lessonId guard keeps `undefined` out of
  // the persisted completedLessonIds array (defense-in-depth — the caller in
  // lessonEngine already gates on lesson.course?.id).
  if (!courseId || !lesson?.lessonId) return Promise.resolve();
  return queueCourseProgressUpdate(async () => {
    const prior = await getCourseProgress(courseId);
    const lessonsInCourse = await getLessonsInCourse(courseId);
    const completedLesson = {
      name: lesson.name,
      learnerPosition: lessonKB?.learnerPosition || '',
      insights: lessonKB?.insights || [],
    };
    const result = await orchestrator.updateCourseProgress(
      lesson.course.name,
      lessonsInCourse,
      prior?.summary || '',
      completedLesson,
      prior?.completedLessonIds || [],
    );
    if (!result?.summary) {
      console.error('[plato] Course progress agent returned no summary:', result);
      return;
    }
    const completedLessonIds = mergeCompletedLessonIds(
      prior?.completedLessonIds,
      result.completedLessonIds,
      lesson.lessonId,
    );
    syncIfUnsaved(await saveCourseProgress(courseId, {
      courseId,
      summary: result.summary,
      completedLessonIds,
      updatedAt: Date.now(),
    }), `courseProgress:${courseId}`);
  });
}
