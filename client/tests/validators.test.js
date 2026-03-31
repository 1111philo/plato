import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSafety, validateCourseKB } from '../js/validators.js';

// -- Helpers ------------------------------------------------------------------

function validCourseKB(overrides = {}) {
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

// -- validateCourseKB ---------------------------------------------------------

describe('validateCourseKB', () => {
  it('accepts a valid course KB', () => {
    assert.equal(validateCourseKB(validCourseKB()), null);
  });

  it('rejects missing exemplar', () => {
    assert.ok(validateCourseKB(validCourseKB({ exemplar: '' })));
  });

  it('rejects empty objectives', () => {
    assert.ok(validateCourseKB(validCourseKB({ objectives: [] })));
  });

  it('rejects objective missing evidence', () => {
    assert.ok(validateCourseKB(validCourseKB({
      objectives: [{ objective: 'Can do X', evidence: '' }],
    })));
  });

  it('rejects missing learnerPosition', () => {
    assert.ok(validateCourseKB(validCourseKB({ learnerPosition: '' })));
  });

  it('rejects missing insights array', () => {
    assert.ok(validateCourseKB(validCourseKB({ insights: 'not array' })));
  });

  it('rejects missing activitiesCompleted', () => {
    assert.ok(validateCourseKB(validCourseKB({ activitiesCompleted: 'zero' })));
  });

  it('rejects missing status', () => {
    assert.ok(validateCourseKB(validCourseKB({ status: '' })));
  });

  it('rejects unsafe content in exemplar', () => {
    assert.ok(validateCourseKB(validCourseKB({ exemplar: 'how to hack a database' })));
  });
});
