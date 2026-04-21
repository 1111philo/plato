import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../src/lib/lessonEngine.js';

function sampleLesson() {
  return {
    lessonId: 'foundation-1',
    name: 'Foundations 1: Professional Identity',
    description: 'Build a clear professional identity statement.',
    exemplar: 'A polished professional identity statement.',
  };
}

describe('buildContext', () => {
  it('switches completed lessons into feedback-only mode', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      {
        status: 'completed',
        progress: 10,
        activitiesCompleted: 12,
      },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.lessonStatus, 'completed');
    assert.match(
      context.postCompletionDirective,
      /feedback/i
    );
    assert.match(
      context.postCompletionDirective,
      /start the next lesson separately/i
    );
  });

  it('does not add post-completion instructions while a lesson is still active', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      {
        status: 'active',
        progress: 6,
        activitiesCompleted: 8,
      },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.lessonStatus, 'active');
    assert.equal(context.postCompletionDirective, undefined);
  });
});
