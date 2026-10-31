/**
 * Lesson markdown checks, shared by the admin lesson PUT and the lesson
 * rewrite scripts (scripts/apply-lessons.js, #261).
 */
import { MIN_OBJECTIVES, MAX_OBJECTIVES } from './lesson-limits.js';

/** The `- Can …` lines under `## Learning Objectives`. */
// Same reading as the client's parseLessonPrompt (client/js/lessonOwner.js):
// every `- ` bullet under a case-insensitive "## Learning Objectives", so the
// 2–4 check counts exactly what the lesson planner will be handed.
export function lessonObjectives(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^## learning objectives\s*$/i.test(l));
  if (start < 0) return null;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const m = line.match(/^-\s+(.+)/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Microlearning constraints. Returns an error string or null. */
export function validateLessonMarkdown(markdown) {
  const objectives = lessonObjectives(markdown);
  if (!objectives) return 'Lesson must have a "## Learning Objectives" section.';
  if (objectives.length < MIN_OBJECTIVES) return `Too few objectives (${objectives.length}). Lessons need at least ${MIN_OBJECTIVES}.`;
  if (objectives.length > MAX_OBJECTIVES) return `Too many objectives (${objectives.length}). Microlearning lessons need ${MIN_OBJECTIVES}-${MAX_OBJECTIVES} objectives.`;
  const notCan = objectives.find((o) => !/^Can\s/.test(o));
  if (notCan) return `Each objective starts with "Can …" (this one doesn't: "${notCan.slice(0, 60)}").`;
  return null;
}
