import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const lessonsDir = resolve(root, 'data', 'lessons');

/**
 * Parse a lesson prompt markdown file (same logic as lessonOwner.js).
 */
function parseLessonPrompt(lessonId, markdown) {
  const lines = markdown.split('\n');
  let name = '';
  let description = '';
  let exemplar = '';
  let coachDirective = '';
  const objectives = [];
  let currentSection = null;
  const sectionBuffer = [];

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

// Load all lesson prompt files
const lessonFiles = readdirSync(lessonsDir).filter(f => f.endsWith('.md'));
const lessons = lessonFiles.map(f => {
  const lessonId = f.replace('.md', '');
  const content = readFileSync(resolve(lessonsDir, f), 'utf8');
  return parseLessonPrompt(lessonId, content);
});

describe('lesson prompt files', () => {
  it('parses any lesson files that exist', () => {
    // Built-in lesson files are optional — lessons can be user-created via SQLite
    // This test validates the format of any .md files present
    for (const lesson of lessons) {
      assert.ok(lesson.lessonId, 'Parsed lesson has a lessonId');
    }
  });

  it('every lesson has required fields', () => {
    for (const lesson of lessons) {
      assert.ok(lesson.lessonId && typeof lesson.lessonId === 'string',
        `Lesson missing lessonId`);
      assert.ok(lesson.name && typeof lesson.name === 'string',
        `Lesson ${lesson.lessonId} missing name`);
      assert.ok(lesson.description && typeof lesson.description === 'string',
        `Lesson ${lesson.lessonId} missing description`);
      assert.ok(lesson.exemplar && typeof lesson.exemplar === 'string',
        `Lesson ${lesson.lessonId} missing exemplar`);
      assert.ok(Array.isArray(lesson.learningObjectives) && lesson.learningObjectives.length > 0,
        `Lesson ${lesson.lessonId} must have at least one learning objective`);
    }
  });

  it('every learning objective is a non-empty string', () => {
    for (const lesson of lessons) {
      for (const obj of lesson.learningObjectives) {
        assert.ok(typeof obj === 'string' && obj.length > 0,
          `Lesson ${lesson.lessonId} has invalid learning objective`);
      }
    }
  });

  it('lessonIds are unique', () => {
    const ids = lessons.map(c => c.lessonId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate lessonIds: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });
});

describe('parseLessonPrompt — Coach Directive', () => {
  const base = [
    '# Deploy a WordPress site',
    '',
    'Ship a live WordPress site for your portfolio project.',
    '',
    '## Exemplar',
    'A deployed WordPress site the learner can explain the hosting choice for.',
    '',
    '## Learning Objectives',
    '- Can compare managed, self-hosted, and WordPress.com hosting',
    '- Can register a domain that represents their project',
  ];

  it('omits coachDirective when the section is absent', () => {
    const parsed = parseLessonPrompt('custom-1', base.join('\n'));
    assert.equal('coachDirective' in parsed, false);
    assert.equal(parsed.exemplar, 'A deployed WordPress site the learner can explain the hosting choice for.');
    assert.equal(parsed.learningObjectives.length, 2);
  });

  it('captures a multi-line coach directive verbatim, codes and URLs intact', () => {
    const directive = [
      'Reference the learner\'s portfolio project throughout. Do not ask what it is.',
      '',
      'If they choose WordPress.com, share code "EduAIMicroCred26": https://wordpress.com/start/business-monthly/?coupon=EduAIMicroCred26',
    ];
    const md = [...base, '', '## Coach Directive', ...directive].join('\n');
    const parsed = parseLessonPrompt('custom-1', md);

    assert.equal(parsed.coachDirective, directive.join('\n'));
    assert.match(parsed.coachDirective, /EduAIMicroCred26/);
    assert.match(parsed.coachDirective, /coupon=EduAIMicroCred26/);
    // The directive must not bleed into the exemplar or objectives.
    assert.equal(parsed.learningObjectives.length, 2);
    assert.doesNotMatch(parsed.exemplar, /EduAIMicroCred26/);
  });
});
