/**
 * Lesson rewrites (#261): export lesson markdown, edit it outside plato
 * (reviewed in a pull request), and apply it back safely. The scripts are
 * scripts/export-lessons.js (read-only) and scripts/apply-lessons.js (dry run
 * unless --apply). This module is the pure part, tested in
 * tests/lib/lesson-rewrite.test.js.
 *
 * An export directory holds `<lessonId>.md` per lesson and `manifest.json`:
 *   { exportedAt, lessons: [{ lessonId, name, status, course, hash, objectives }] }
 * where `hash` is of the markdown as exported. Applying a lesson requires:
 * - the stored lesson still matches `hash` (nobody edited it since export);
 * - the edit passes validateLessonMarkdown and keeps the objective count;
 * - the edit still starts with a `# Title`.
 */
import { createHash } from 'node:crypto';
import { validateLessonMarkdown, lessonObjectives } from './lesson-markdown.js';

export const hashOf = (markdown) => createHash('sha256').update(String(markdown ?? '')).digest('hex').slice(0, 16);
export const titleOf = (markdown) => String(markdown || '').match(/^# (.+)$/m)?.[1]?.trim() || null;

/** Manifest entry for one stored lesson record (`data` is the record's data). */
export function manifestEntry(lessonId, data) {
  return {
    lessonId,
    name: data.name || lessonId,
    status: data.status || null,
    course: data.course || null,
    hash: hashOf(data.markdown),
    objectives: (lessonObjectives(data.markdown) || []).length,
  };
}

/**
 * What applying `edited` (markdown, or null if the file is missing) would do
 * to `current` (the stored record's data, or null). Returns `{ action, reason? }`
 * with action 'update' | 'unchanged' | 'conflict' | 'invalid' | 'missing'.
 */
export function planLesson(entry, current, edited) {
  if (!current) return { action: 'missing', reason: 'the lesson no longer exists' };
  if (edited == null) return { action: 'unchanged', reason: 'no file' };
  if (hashOf(current.markdown) !== entry.hash) return { action: 'conflict', reason: 'changed in plato since the export; export again' };
  if (edited === current.markdown) return { action: 'unchanged' };
  if (!titleOf(edited)) return { action: 'invalid', reason: 'missing a "# Title" line' };
  const err = validateLessonMarkdown(edited);
  if (err) return { action: 'invalid', reason: err };
  const n = (lessonObjectives(edited) || []).length;
  if (n !== entry.objectives) return { action: 'invalid', reason: `objective count changed (${entry.objectives} → ${n}); rewrites keep the objectives' number` };
  return { action: 'update' };
}

/** The record to write: new markdown and title, everything else kept. */
export function rewrittenRecord(current, edited, actor = 'lesson-rewrite') {
  return { ...current, markdown: edited, name: titleOf(edited) || current.name, updatedBy: actor, updatedByName: actor };
}
