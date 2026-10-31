/**
 * Lesson rewrite planning (#261, src/lib/lesson-rewrite.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { manifestEntry, planLesson, rewrittenRecord, hashOf, titleOf } from '../../src/lib/lesson-rewrite.js';

const MD = '# Values\n\nWhy values matter.\n\n## Exemplar\n\nA reflection.\n\n## Learning Objectives\n\n- Can name three values\n- Can connect one to a decision\n';
const current = { name: 'Values', markdown: MD, status: 'public', course: 'u1', sharedWith: [] };
const entry = manifestEntry('les-1', current);

describe('lesson rewrite', () => {
  it('records the hash and objective count at export', () => {
    assert.deepEqual(entry, { lessonId: 'les-1', name: 'Values', status: 'public', course: 'u1', hash: hashOf(MD), objectives: 2 });
  });
  it('applies a valid edit that keeps the objective count', () => {
    const edited = MD.replace('Why values matter.', 'Your values steer your choices. In this lesson you name yours.');
    assert.deepEqual(planLesson(entry, current, edited), { action: 'update' });
    const next = rewrittenRecord(current, edited);
    assert.deepEqual([next.markdown, next.status, next.course, next.updatedBy], [edited, 'public', 'u1', 'lesson-rewrite']);
  });
  it('refuses lessons changed in plato since the export', () => {
    assert.equal(planLesson(entry, { ...current, markdown: `${MD}x` }, MD.replace('Values', 'V')).action, 'conflict');
  });
  it('refuses edits that change the objective count, break the checks, or drop the title', () => {
    assert.match(planLesson(entry, current, `${MD}- Can do a third thing\n`).reason, /objective count changed \(2 → 3\)/);
    assert.equal(planLesson(entry, current, MD.replace('## Learning Objectives', '## Goals')).action, 'invalid');
    assert.match(planLesson(entry, current, MD.replace('# Values\n', '')).reason, /Title/);
  });
  it('unchanged, missing file, and deleted lessons', () => {
    assert.equal(planLesson(entry, current, MD).action, 'unchanged');
    assert.equal(planLesson(entry, current, null).action, 'unchanged');
    assert.equal(planLesson(entry, null, MD).action, 'missing');
    assert.equal(titleOf(MD), 'Values');
  });
});

describe('validateLessonMarkdown reads objectives like the client (#451 review)', async () => {
  const { validateLessonMarkdown, lessonObjectives } = await import('../../src/lib/lesson-markdown.js');
  const md = (bullets, heading = '## Learning Objectives', eol = '\n') => ['# T', '', 'D', '', heading, '', ...bullets].join(eol);
  it('counts every bullet, so a lesson can’t sneak in a fifth objective', () => {
    assert.match(validateLessonMarkdown(md(['- Can a', '- Can b', '- Can c', '- Can d', '- Also e'])), /Too many objectives \(5\)/);
  });
  it('requires "Can …", accepts any heading case and CRLF', () => {
    assert.match(validateLessonMarkdown(md(['- Can a', '- Know b'])), /starts with "Can/);
    assert.equal(validateLessonMarkdown(md(['- Can a', '- Can b'], '## learning objectives', '\r\n')), null);
    assert.deepEqual(lessonObjectives(md(['- Can a', '- Can b'])), ['Can a', 'Can b']);
  });
});
