// Lesson visibility helpers shared by admin dashboard stats and the
// denormalized activity counter (sync.js). Dashboard/activity stats count
// ONLY public system lessons — drafts, privates (even when shared to a
// learner), and user-created custom lessons are all excluded. Custom lessons
// live under the learner's own sync-data (`lessons:custom-*`) and never have a
// `_system:lesson:*` record, so they fall out naturally: a completion only
// counts if its lesson id maps to a public `_system:lesson:*` record.

/**
 * Normalize a lesson's visibility status.
 * `draft` is a first-class status for in-progress lessons that have no markdown
 * yet. Legacy records with `status: 'draft'` AND markdown present are treated
 * as `private` to preserve the old auto-normalize semantics (CLAUDE.md: "legacy
 * draft/published statuses are auto-normalized to private/public").
 */
export function normalizeStatus(status, hasMarkdown = true) {
  if (status === 'published' || status === 'public') return 'public';
  if (status === 'draft' && !hasMarkdown) return 'draft';
  return 'private';
}

/** True if a `_system:lesson:*` record resolves to public visibility. */
export function isPublicLessonRecord(data) {
  return normalizeStatus(data?.status, !!data?.markdown) === 'public';
}

/**
 * Build the set of lesson ids that are countable in dashboard/activity stats
 * (i.e. public) from a list of `_system` sync-data items.
 */
export function publicLessonIds(systemItems) {
  const ids = new Set();
  for (const i of systemItems || []) {
    if (!i.dataKey?.startsWith('lesson:')) continue;
    if (isPublicLessonRecord(i.data)) ids.add(i.dataKey.slice('lesson:'.length));
  }
  return ids;
}
