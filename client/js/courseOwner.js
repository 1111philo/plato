/**
 * Course Owner — loads course prompts from markdown files,
 * manages course KB updates after assessments.
 */

import { authenticatedFetch } from './auth.js';
import { getUserCourses } from './storage.js';

/** Max recent insights to keep in full. Older ones get summarized. */
const MAX_RECENT_INSIGHTS = 10;

let coursesCache = null;

/**
 * Load all courses from the server.
 * Returns an array of { courseId, name, description, exemplar, learningObjectives }.
 */
export async function loadCourses() {
  if (coursesCache) return coursesCache;

  const courses = [];
  try {
    const resp = await authenticatedFetch('/v1/courses');
    if (resp.ok) {
      const serverCourses = await resp.json();
      for (const course of serverCourses) {
        if (course.markdown) {
          courses.push(parseCoursePrompt(course.courseId, course.markdown));
        }
      }
    }
  } catch { /* server unavailable */ }

  // Merge user-created courses from sync-data
  try {
    const userCourses = await getUserCourses();
    for (const uc of userCourses) {
      if (uc.markdown && !courses.some(c => c.courseId === uc.courseId)) {
        courses.push(parseCoursePrompt(uc.courseId, uc.markdown));
      }
    }
  } catch { /* ignore */ }

  coursesCache = courses;
  return courses;
}

/** Clear the cache so loadCourses() re-fetches on next call. */
export function invalidateCoursesCache() {
  coursesCache = null;
}

/**
 * Parse a course prompt markdown file into structured data.
 */
export function parseCoursePrompt(courseId, markdown) {
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

  return { courseId, name, description, exemplar, learningObjectives: objectives };
}

/**
 * Update the course KB after an assessment.
 * Merges new insights and learner position from the assessor's courseKBUpdate.
 * Prunes old insights to keep context manageable for long learning loops.
 */
export function updateCourseKBFromAssessment(courseKB, assessmentResult) {
  const update = assessmentResult.courseKBUpdate;
  if (!update) return courseKB;

  const newKB = { ...courseKB };

  // Append new insights, then prune if needed
  if (update.insights?.length) {
    const allInsights = [...(newKB.insights || []), ...update.insights];

    if (allInsights.length > MAX_RECENT_INSIGHTS) {
      // Summarize older insights into one condensed entry
      const older = allInsights.slice(0, allInsights.length - MAX_RECENT_INSIGHTS);
      const recent = allInsights.slice(-MAX_RECENT_INSIGHTS);
      const summary = `[Earlier observations: ${older.join('; ')}]`;
      newKB.insights = [summary, ...recent];
    } else {
      newKB.insights = allInsights;
    }
  }

  // Replace learner position
  if (update.learnerPosition) {
    newKB.learnerPosition = update.learnerPosition;
  }

  // Increment activities completed
  newKB.activitiesCompleted = (newKB.activitiesCompleted || 0) + 1;

  // Mark completed if achieved
  if (assessmentResult.achieved) {
    newKB.status = 'completed';
  }

  return newKB;
}
