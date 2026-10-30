/**
 * Course → Unit → Lesson hierarchy (#408).
 *
 * Storage keeps the names it had before the hierarchy existed, so nothing
 * that references them (learner progress, cross-lesson memory, stats) moves:
 *
 * | UI label | Record                   | Membership                    | Order              |
 * |----------|--------------------------|-------------------------------|--------------------|
 * | Course   | `_system:program:<id>`   | (top level)                   | by name            |
 * | Unit     | `_system:course:<id>`    | `unit.programId`              | `program.unitIds`  |
 * | Lesson   | `_system:lesson:<id>`    | `lesson.course` (the unit id) | `unit.lessonIds`   |
 *
 * Order arrays only order; they never decide membership. `orderIds` lists the
 * ids an array names that are still members, then any members it's missing,
 * sorted by name, which is exactly the pre-hierarchy behavior. A missing or
 * stale array can't hide or duplicate anything; it just falls back to
 * alphabetical.
 *
 * ID prefixes: units `course-<8>` (made client-side, as before), courses
 * (programs) `prog-<8>`.
 */

const byName = (nameOf) => (a, b) => (nameOf(a) || '').localeCompare(nameOf(b) || '', undefined, { numeric: true, sensitivity: 'base' });

/** Members in `order` first (deduped, members only), then the rest by name. */
export function orderIds(order, memberIds, nameOf = (id) => id) {
  const members = new Set(memberIds);
  const seen = new Set();
  const ordered = [];
  for (const id of Array.isArray(order) ? order : []) {
    if (members.has(id) && !seen.has(id)) { ordered.push(id); seen.add(id); }
  }
  const rest = memberIds.filter((id) => !seen.has(id)).sort(byName(nameOf));
  return [...ordered, ...rest];
}

/**
 * Build the hierarchy from `_system` sync-data items (db.getAllSyncData).
 * Returns:
 * - `programs`: ordered by name, `[{ id, name, description, unitIds }]`
 * - `units`: Map id → `{ id, name, programId, lessonIds }`, with `programId`
 *   null if missing or pointing at a deleted program
 * - `placement`: Map lessonId → `{ unitId, programId, unitPosition, lessonPosition }`
 *   for lessons in a unit
 * - `unassignedUnitIds`: by name
 */
export function buildHierarchy(systemItems) {
  const programData = new Map();
  const unitData = new Map();
  const lessonsByUnit = new Map();
  const lessonName = new Map();
  for (const i of systemItems) {
    if (i.dataKey.startsWith('program:')) programData.set(i.dataKey.slice(8), i.data || {});
    else if (i.dataKey.startsWith('course:')) unitData.set(i.dataKey.slice(7), i.data || {});
    else if (i.dataKey.startsWith('lesson:')) {
      const id = i.dataKey.slice(7);
      lessonName.set(id, i.data?.name || id);
      const unitId = i.data?.course;
      if (unitId) (lessonsByUnit.get(unitId) || lessonsByUnit.set(unitId, []).get(unitId)).push(id);
    }
  }

  const units = new Map();
  for (const [id, d] of unitData) {
    const programId = d.programId && programData.has(d.programId) ? d.programId : null;
    const memberLessons = lessonsByUnit.get(id) || [];
    units.set(id, { id, name: d.name || id, programId, lessonIds: orderIds(d.lessonIds, memberLessons, (l) => lessonName.get(l)) });
  }

  const unitName = (u) => units.get(u)?.name;
  const programs = [...programData.entries()]
    .map(([id, d]) => {
      const memberUnits = [...units.values()].filter((u) => u.programId === id).map((u) => u.id);
      return { id, name: d.name || id, description: d.description || '', unitIds: orderIds(d.unitIds, memberUnits, unitName) };
    })
    .sort(byName((p) => p.name));

  const placement = new Map();
  for (const p of programs) {
    p.unitIds.forEach((unitId, unitPosition) => {
      units.get(unitId).lessonIds.forEach((lessonId, lessonPosition) => {
        placement.set(lessonId, { unitId, programId: p.id, unitPosition, lessonPosition });
      });
    });
  }
  const unassignedUnitIds = [...units.values()].filter((u) => !u.programId).map((u) => u.id).sort(byName(unitName));
  for (const unitId of unassignedUnitIds) {
    units.get(unitId).lessonIds.forEach((lessonId, lessonPosition) => {
      placement.set(lessonId, { unitId, programId: null, unitPosition: null, lessonPosition });
    });
  }

  return { programs, units, placement, unassignedUnitIds };
}

/** True when `ids` is exactly `members` reordered: no additions, drops, or duplicates. */
export function isPermutation(ids, members) {
  if (!Array.isArray(ids) || ids.length !== members.length) return false;
  const set = new Set(ids);
  return set.size === ids.length && members.every((m) => set.has(m));
}
