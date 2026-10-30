/**
 * Lesson Owner — loads lesson prompts from markdown files
 * and parses their structure.
 */

import { authenticatedFetch } from './auth.js';
import { getUserLessons } from './storage.js';
import { sortLessons } from '../src/lib/lessonOrder.js';

let lessonsCache = null;

/**
 * Load all lessons from the server.
 * Returns an array of { lessonId, name, description, exemplar, learningObjectives,
 * course?, unit?, program? }, in Course → Unit → Lesson order (lessonOrder.js).
 */
export async function loadLessons() {
  if (lessonsCache) return lessonsCache;

  const lessons = [];
  try {
    const resp = await authenticatedFetch('/v1/lessons');
    if (resp.ok) {
      const serverLessons = await resp.json();
      for (const lesson of serverLessons) {
        if (lesson.markdown) {
          // parseLessonPrompt only knows about fields encoded inside the
          // markdown (name, description, exemplar, objectives). Top-level
          // server fields need to be carried forward explicitly so they
          // survive into the client-side lesson model used by the classroom
          // UI and the coach context builder: `unit` and `program` (the
          // Course → Unit → Lesson placement and order, #408) and the legacy
          // `course` block, which is the unit.
          const parsed = parseLessonPrompt(lesson.lessonId, lesson.markdown);
          if (lesson.course) parsed.course = lesson.course;
          if (lesson.unit) parsed.unit = lesson.unit;
          if (lesson.program) parsed.program = lesson.program;
          lessons.push(parsed);
        }
      }
    }
  } catch { /* server unavailable */ }

  // Merge user-created lessons from sync-data
  try {
    const userLessons = await getUserLessons();
    for (const uc of userLessons) {
      if (uc.markdown && !lessons.some(c => c.lessonId === uc.lessonId)) {
        lessons.push(parseLessonPrompt(uc.lessonId, uc.markdown));
      }
    }
  } catch { /* ignore */ }

  lessonsCache = sortLessons(lessons);
  return lessonsCache;
}

/** Clear the cache so loadLessons() re-fetches on next call. */
export function invalidateLessonsCache() {
  lessonsCache = null;
}

/**
 * Return the lessons belonging to a unit (stored as a course, #408) as
 * `[{ name, description }]`, in the unit's order.
 * Used to give the course-progress agent the course's shape for naming and
 * framing. Empty array when the course has no lessons or is unknown.
 */
export async function getLessonsInCourse(courseId) {
  if (!courseId) return [];
  const lessons = await loadLessons();
  return lessons
    .filter(l => l.course?.id === courseId)
    .map(l => ({ name: l.name, description: l.description }));
}

/**
 * Parse a lesson prompt markdown file into structured data.
 */
export function parseLessonPrompt(lessonId, markdown) {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  let exemplar = '';
  let coachDirective = '';
  const objectives = [];
  let currentSection = null;
  const sectionBuffer = [];

  // Free-form prose sections are accumulated into sectionBuffer and flushed
  // when the next `## ` heading (or EOF) is reached. `## Coach Directive` is
  // optional, author-supplied runtime guidance for the Coach (e.g. "reference
  // the learner's portfolio project", "offer this code") — it must round-trip
  // verbatim, so it gets the same buffer treatment as the exemplar.
  const flushSection = () => {
    if (currentSection === 'exemplar') exemplar = sectionBuffer.join('\n').trim();
    if (currentSection === 'coach_directive') coachDirective = sectionBuffer.join('\n').trim();
  };

  for (const line of lines) {
    if (line.startsWith('# ') && !name) {
      name = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('## ')) {
      flushSection();
      sectionBuffer.length = 0;
      currentSection = line.slice(3).trim().toLowerCase().replace(/\s+/g, '_');
      continue;
    }

    if (currentSection === null && line.trim() && name && !description) {
      description = line.trim();
      continue;
    }

    if (currentSection === 'exemplar' || currentSection === 'coach_directive') {
      sectionBuffer.push(line);
    }

    if (currentSection === 'learning_objectives') {
      const match = line.match(/^-\s+(.+)/);
      if (match) objectives.push(match[1].trim());
    }
  }

  flushSection();

  const parsed = { lessonId, name, description, exemplar, learningObjectives: objectives };
  if (coachDirective) parsed.coachDirective = coachDirective;
  return parsed;
}
