import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, applyCoachResponseToKB } from '../src/lib/lessonEngine.js';
import { LESSON_PHASES } from '../src/lib/constants.js';

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

  it('omits pacing directives for completed lessons even past target', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      {
        status: 'completed',
        progress: 10,
        activitiesCompleted: 25,
      },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.pacingDirective, undefined);
    assert.ok(context.postCompletionDirective);
  });

  it('still emits pacing directives for active lessons over target', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      {
        status: 'active',
        progress: 6,
        activitiesCompleted: 15,
      },
      'Learner profile summary',
      'Alex'
    ));

    assert.ok(context.pacingDirective);
    assert.equal(context.postCompletionDirective, undefined);
  });
});

describe('applyCoachResponseToKB', () => {
  const activeKB = () => ({
    status: 'active',
    progress: 7,
    activitiesCompleted: 8,
    insights: [],
    learnerPosition: 'Making progress',
  });

  const completedKB = () => ({
    status: 'completed',
    progress: 10,
    activitiesCompleted: 12,
    completedAt: 1_600_000_000_000,
    insights: [],
    learnerPosition: 'Exemplar achieved',
  });

  it('transitions to completed and reports achieved on the completion turn', () => {
    const result = applyCoachResponseToKB(
      activeKB(),
      { progress: 10, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.achieved, true);
    assert.equal(result.phase, LESSON_PHASES.COMPLETED);
    assert.equal(result.lessonKB.status, 'completed');
    assert.equal(result.lessonKB.completedAt, 1_700_000_000_000);
    assert.equal(result.lessonKB.activitiesCompleted, 9);
  });

  it('does not re-fire achieved when sending another message after completion', () => {
    const result = applyCoachResponseToKB(
      completedKB(),
      { progress: 10, kbUpdate: { insights: ['feedback noted'] }, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.achieved, false);
    assert.equal(result.phase, LESSON_PHASES.COMPLETED);
    assert.equal(result.lessonKB.status, 'completed');
  });

  it('freezes activitiesCompleted once the lesson is complete', () => {
    const prev = completedKB();
    const result = applyCoachResponseToKB(
      prev,
      { progress: 10, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.lessonKB.activitiesCompleted, prev.activitiesCompleted);
  });

  it('keeps completedAt from the original completion turn', () => {
    const prev = completedKB();
    const originalCompletedAt = prev.completedAt;
    const result = applyCoachResponseToKB(
      prev,
      { progress: 9, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.lessonKB.completedAt, originalCompletedAt);
    assert.equal(result.phase, LESSON_PHASES.COMPLETED);
  });

  it('returns LEARNING phase for active lessons below progress 10', () => {
    const result = applyCoachResponseToKB(
      activeKB(),
      { progress: 6, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.achieved, false);
    assert.equal(result.phase, LESSON_PHASES.LEARNING);
    assert.equal(result.lessonKB.status, 'active');
    assert.equal(result.lessonKB.activitiesCompleted, 9);
  });

  it('does not mutate the input KB', () => {
    const prev = completedKB();
    const snapshot = JSON.parse(JSON.stringify(prev));
    applyCoachResponseToKB(
      prev,
      { progress: 9, kbUpdate: { insights: ['new insight'], learnerPosition: 'updated' }, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.deepEqual(prev, snapshot);
  });
});
