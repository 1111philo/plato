// Course completion counts for the learner's lesson list (#395). Pure so it's
// unit-tested (client/tests/courseCompletion.test.js).

/**
 * `{ [courseId]: { completed, total } }` over ALL of the learner's lessons —
 * not the filtered/paginated view, so a status filter like "Not started"
 * can't turn "5 of 8" into "0 of 3". Custom (`custom-*`) lessons are the
 * learner's own and don't belong to a course's progress; lessons without a
 * course aren't counted.
 */
export function courseCompletion(lessons, lessonData) {
  const byCourse = {};
  for (const lesson of lessons) {
    const courseId = lesson.course?.id;
    if (!courseId || lesson.lessonId.startsWith('custom-')) continue;
    const c = (byCourse[courseId] ||= { completed: 0, total: 0 });
    c.total++;
    if (lessonData[lesson.lessonId]?.status === 'completed') c.completed++;
  }
  return byCourse;
}

/**
 * Split an already course-sorted list into consecutive runs by course id, for
 * one header per course on the current page.
 */
export function groupByCourse(lessons) {
  const groups = [];
  for (const lesson of lessons) {
    const courseId = lesson.course?.id || null;
    const last = groups[groups.length - 1];
    if (last && last.courseId === courseId) last.lessons.push(lesson);
    else groups.push({ courseId, courseName: lesson.course?.name || null, lessons: [lesson] });
  }
  return groups;
}
