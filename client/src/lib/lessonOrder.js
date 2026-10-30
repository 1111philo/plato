// Learner-side order of the Course → Unit → Lesson hierarchy (#408). The
// server computes positions (server/src/lib/hierarchy.js) and inlines them
// on each lesson as `program: { id, name, position }` and
// `unit: { id, name, position, lessonPosition }`. These pure helpers sort,
// group, and pick the next lesson from those fields. Unit tests:
// client/tests/lessonOrder.test.js. Replaces
// courseCompletion.js (#395), which grouped and counted by unit only.

const byName = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
const rank = (v) => (typeof v === 'number' ? v : Number.POSITIVE_INFINITY);

/**
 * Courses in their order, then units in the course's order, then lessons in
 * the unit's order. Units outside any course come after courses; lessons
 * outside any unit, including the learner's own custom-* lessons, come last.
 * Ties fall back to names.
 */
export function compareLessons(a, b) {
  const pa = a.program, pb = b.program;
  if (!!pa !== !!pb) return pa ? -1 : 1;
  if (pa && pb && pa.id !== pb.id) return rank(pa.position) - rank(pb.position) || byName(pa.name, pb.name);
  const ua = a.unit, ub = b.unit;
  if (!!ua !== !!ub) return ua ? -1 : 1;
  if (ua && ub && ua.id !== ub.id) return rank(ua.position) - rank(ub.position) || byName(ua.name, ub.name);
  if (ua && ub) {
    const d = rank(ua.lessonPosition) - rank(ub.lessonPosition);
    if (d) return d;
  }
  return byName(a.name, b.name);
}

export const sortLessons = (lessons) => lessons.slice().sort(compareLessons);

/**
 * The lesson after `lessonId` in the hierarchy order. It continues into the
 * next unit of the same course, and stays within the unit when the unit
 * isn't in a course. Returns null at the end, for lessons outside any unit,
 * or for an unknown id.
 */
export function nextLessonAfter(lessons, lessonId) {
  const current = lessons.find((l) => l.lessonId === lessonId);
  if (!current?.unit) return null;
  const scope = current.program
    ? lessons.filter((l) => l.program?.id === current.program.id)
    : lessons.filter((l) => l.unit?.id === current.unit.id && !l.program);
  const ordered = sortLessons(scope);
  const i = ordered.findIndex((l) => l.lessonId === lessonId);
  return i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null;
}

/**
 * Split an already-sorted page of lessons into runs for display:
 * `[{ key, program, units: [{ key, unit, lessons }] }]`, where `program` and
 * `unit` are the inlined `{ id, name }` objects or null.
 */
export function groupForDisplay(sorted) {
  const groups = [];
  for (const lesson of sorted) {
    const programKey = lesson.program?.id || (lesson.unit ? 'units-without-course' : 'other');
    let g = groups[groups.length - 1];
    if (!g || g.key !== programKey) {
      g = { key: programKey, program: lesson.program || null, units: [] };
      groups.push(g);
    }
    const unitKey = lesson.unit?.id || 'no-unit';
    let u = g.units[g.units.length - 1];
    if (!u || u.key !== unitKey) {
      u = { key: unitKey, unit: lesson.unit || null, lessons: [] };
      g.units.push(u);
    }
    u.lessons.push(lesson);
  }
  return groups;
}

/**
 * `{ [id]: { completed, total } }` per course (`level` 'program') or per unit
 * (`level` 'unit'), over ALL of the learner's lessons, never the filtered or
 * paginated view, so a status filter like "Not started" can't turn "5 of 8"
 * into "0 of 3" (#395). The learner's own custom-* lessons and lessons
 * outside that level aren't counted.
 */
export function completionBy(level, lessons, lessonData) {
  const out = {};
  for (const l of lessons) {
    const id = l[level]?.id;
    if (!id || l.lessonId.startsWith('custom-')) continue;
    const c = (out[id] ||= { completed: 0, total: 0 });
    c.total++;
    if (lessonData[l.lessonId]?.status === 'completed') c.completed++;
  }
  return out;
}
