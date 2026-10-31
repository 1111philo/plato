/**
 * Lesson markdown checks, shared by the admin lesson PUT and the lesson
 * rewrite scripts (scripts/apply-lessons.js, #261).
 */
import { MIN_OBJECTIVES, MAX_OBJECTIVES } from './lesson-limits.js';

/** The `- Can …` lines under `## Learning Objectives`. */
export function lessonObjectives(markdown) {
  const section = String(markdown || '').split(/^## Learning Objectives$/m)[1];
  if (!section) return null;
  const out = [];
  for (const line of section.split('\n')) {
    if (/^## /.test(line)) break;
    if (/^- Can .+/.test(line)) out.push(line.slice(2).trim());
  }
  return out;
}

/** Microlearning constraints. Returns an error string or null. */
export function validateLessonMarkdown(markdown) {
  const objectives = lessonObjectives(markdown);
  if (!objectives) return 'Lesson must have a "## Learning Objectives" section.';
  if (objectives.length < MIN_OBJECTIVES) return `Too few objectives (${objectives.length}). Lessons need at least ${MIN_OBJECTIVES}.`;
  if (objectives.length > MAX_OBJECTIVES) return `Too many objectives (${objectives.length}). Microlearning lessons need ${MIN_OBJECTIVES}-${MAX_OBJECTIVES} objectives.`;
  return null;
}
