import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const coursesDir = resolve(root, 'data', 'courses');

/**
 * Parse a course prompt markdown file (same logic as courseOwner.js).
 */
function parseCoursePrompt(courseId, markdown) {
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

// Load all course prompt files
const courseFiles = readdirSync(coursesDir).filter(f => f.endsWith('.md'));
const courses = courseFiles.map(f => {
  const courseId = f.replace('.md', '');
  const content = readFileSync(resolve(coursesDir, f), 'utf8');
  return parseCoursePrompt(courseId, content);
});

describe('course prompt files', () => {
  it('parses any course files that exist', () => {
    // Built-in course files are optional — courses can be user-created via SQLite
    // This test validates the format of any .md files present
    for (const course of courses) {
      assert.ok(course.courseId, 'Parsed course has a courseId');
    }
  });

  it('every course has required fields', () => {
    for (const course of courses) {
      assert.ok(course.courseId && typeof course.courseId === 'string',
        `Course missing courseId`);
      assert.ok(course.name && typeof course.name === 'string',
        `Course ${course.courseId} missing name`);
      assert.ok(course.description && typeof course.description === 'string',
        `Course ${course.courseId} missing description`);
      assert.ok(course.exemplar && typeof course.exemplar === 'string',
        `Course ${course.courseId} missing exemplar`);
      assert.ok(Array.isArray(course.learningObjectives) && course.learningObjectives.length > 0,
        `Course ${course.courseId} must have at least one learning objective`);
    }
  });

  it('every learning objective is a non-empty string', () => {
    for (const course of courses) {
      for (const obj of course.learningObjectives) {
        assert.ok(typeof obj === 'string' && obj.length > 0,
          `Course ${course.courseId} has invalid learning objective`);
      }
    }
  });

  it('courseIds are unique', () => {
    const ids = courses.map(c => c.courseId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate courseIds: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });
});
