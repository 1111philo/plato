// Admin → Lessons filters (#527), the same shape as Admin → Users'
// (lib/userFilters.js): each facet is a set of checked values, OR within a
// facet, AND across facets, empty means no filter. FiltersMenu renders the
// facets; describeFilters (userFilters.js) makes the chips. Tested in
// client/tests/lessonFilters.test.js.

const NONE = '__none';

function valuesOf(lesson, facet, unitProgram) {
  if (facet.key === 'status') return [lesson.status];
  if (facet.key === 'unit') return [lesson.course || NONE];
  if (facet.key === 'course') return [(lesson.course && unitProgram.get(lesson.course)) || NONE];
  if (facet.key === 'createdBy') return [lesson.createdByName || NONE];
  return [];
}

/**
 * `units`: `/v1/admin/units` (each `{ unitId|courseId, name, programId }`).
 * `programs`: `[{ programId, name }]`. Returns `{ facets, match }`, where
 * `match(lesson, filters)` applies them.
 */
export function buildLessonFacets({ lessons, units = [], programs = [] }) {
  const unitId = (u) => u.unitId || u.courseId;
  const unitProgram = new Map(units.map((u) => [unitId(u), u.programId || null]));
  const programName = new Map(programs.map((p) => [p.programId, p.name]));
  const facets = [
    { key: 'status', label: 'Status', options: [
      { value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }, { value: 'draft', label: 'Draft' },
    ] },
  ];
  if (programs.length) {
    facets.push({ key: 'course', label: 'Course', options: [
      ...programs.map((p) => ({ value: p.programId, label: p.name })), { value: NONE, label: 'No course' },
    ] });
  }
  if (units.length) {
    facets.push({ key: 'unit', label: 'Unit', options: [
      ...units.map((u) => {
        const course = programName.get(u.programId);
        return { value: unitId(u), label: course && programs.length > 1 ? `${course} › ${u.name}` : u.name };
      }),
      { value: NONE, label: 'No unit' },
    ] });
  }
  const authors = [...new Set(lessons.map((l) => l.createdByName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (authors.length) {
    facets.push({ key: 'createdBy', label: 'Created by', options: authors.map((a) => ({ value: a, label: a })) });
  }
  for (const facet of facets) {
    for (const o of facet.options) o.count = lessons.filter((l) => valuesOf(l, facet, unitProgram).includes(o.value)).length;
  }
  const match = (lesson, filters) => facets.every((facet) => {
    const want = filters[facet.key];
    return !want?.length || valuesOf(lesson, facet, unitProgram).some((v) => want.includes(v));
  });
  return { facets, match };
}
