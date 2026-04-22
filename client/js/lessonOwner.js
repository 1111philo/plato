/**
 * Lesson Owner — loads lesson prompts from markdown files
 * and parses their structure.
 */

import { authenticatedFetch } from './auth.js';
import { getUserLessons } from './storage.js';

let lessonsCache = null;

/**
 * Load all lessons from the server.
 * Returns an array of { lessonId, name, description, exemplar, learningObjectives }.
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
          lessons.push(parseLessonPrompt(lesson.lessonId, lesson.markdown));
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

  lessons.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  lessonsCache = lessons;
  return lessons;
}

/** Clear the cache so loadLessons() re-fetches on next call. */
export function invalidateLessonsCache() {
  lessonsCache = null;
}

/**
 * Parse a lesson prompt markdown file into structured data.
 */
export function parseLessonPrompt(lessonId, markdown) {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  let exemplar = '';
  const objectives = [];
  let currentSection = null;
  const sectionBuffer = [];

  for (const line of lines) {
    if (line.startsWith('# ') && !name) {
      name = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('## ')) {
      if (currentSection === 'exemplar') {
        exemplar = sectionBuffer.join('\n').trim();
      }
      sectionBuffer.length = 0;
      currentSection = line.slice(3).trim().toLowerCase().replace(/\s+/g, '_');
      continue;
    }

    if (currentSection === null && line.trim() && name && !description) {
      description = line.trim();
      continue;
    }

    if (currentSection === 'exemplar') {
      sectionBuffer.push(line);
    }

    if (currentSection === 'learning_objectives') {
      const match = line.match(/^-\s+(.+)/);
      if (match) objectives.push(match[1].trim());
    }
  }

  if (currentSection === 'exemplar') {
    exemplar = sectionBuffer.join('\n').trim();
  }

  return { lessonId, name, description, exemplar, learningObjectives: objectives };
}
