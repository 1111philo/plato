import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSafety, validateLessonKB } from '../js/validators.js';

// -- Helpers ------------------------------------------------------------------

function validLessonKB(overrides = {}) {
  return {
    exemplar: 'A professional portfolio published on WordPress...',
    objectives: [
      { objective: 'Can identify interests and values', evidence: 'Written reflection connecting values to professional context' },
      { objective: 'Can launch WordPress Playground', evidence: 'Published post on Playground instance' },
    ],
    learnerPosition: 'New learner, no activities completed yet.',
    insights: [],
    activitiesCompleted: 0,
    status: 'active',
    ...overrides,
  };
}

// -- validateSafety -----------------------------------------------------------

describe('validateSafety', () => {
  it('returns null for safe text', () => {
    assert.equal(validateSafety('Write a blog post about cooking'), null);
  });

  it('flags unsafe content', () => {
    assert.ok(validateSafety('how to hack a website'));
    assert.ok(validateSafety('kill yourself'));
    assert.ok(validateSafety('self-harm methods'));
  });
});

// -- validateLessonKB ---------------------------------------------------------

describe('validateLessonKB', () => {
  it('accepts a valid lesson KB', () => {
    assert.equal(validateLessonKB(validLessonKB()), null);
  });

  it('rejects missing exemplar', () => {
    assert.ok(validateLessonKB(validLessonKB({ exemplar: '' })));
  });

  it('rejects empty objectives', () => {
    assert.ok(validateLessonKB(validLessonKB({ objectives: [] })));
  });

  it('rejects objective missing evidence', () => {
    assert.ok(validateLessonKB(validLessonKB({
      objectives: [{ objective: 'Can do X', evidence: '' }],
    })));
  });

  it('rejects missing learnerPosition', () => {
    assert.ok(validateLessonKB(validLessonKB({ learnerPosition: '' })));
  });

  it('rejects missing insights array', () => {
    assert.ok(validateLessonKB(validLessonKB({ insights: 'not array' })));
  });

  it('rejects missing activitiesCompleted', () => {
    assert.ok(validateLessonKB(validLessonKB({ activitiesCompleted: 'zero' })));
  });

  it('rejects missing status', () => {
    assert.ok(validateLessonKB(validLessonKB({ status: '' })));
  });

  it('rejects unsafe content in exemplar', () => {
    assert.ok(validateLessonKB(validLessonKB({ exemplar: 'how to hack a database' })));
  });
});
