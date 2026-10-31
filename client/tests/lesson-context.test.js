/**
 * Tests for the completed-lesson feedback-mode contract:
 *   - buildContext emits lessonStatus and the post-completion directive once
 *     a lesson is complete, and suppresses pacing directives in that state.
 *   - applyCoachResponseToKB treats `achieved` as a one-shot transition and
 *     freezes activitiesCompleted post-completion so confetti / completion-
 *     profile updates don't re-fire on feedback messages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};
globalThis.fetch = async () => ({ ok: false, status: 404 });

const { buildContext, applyCoachResponseToKB, openingProgress } = await import('../src/lib/lessonEngine.js');
const { LESSON_PHASES } = await import('../src/lib/constants.js');

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
      { status: 'completed', progress: 10, activitiesCompleted: 12 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.lessonStatus, 'completed');
    assert.match(context.postCompletionDirective, /feedback/i);
    assert.match(context.postCompletionDirective, /start the next lesson separately/i);
  });

  it('does not add post-completion instructions while a lesson is still active', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      { status: 'active', progress: 6, activitiesCompleted: 8 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.lessonStatus, 'active');
    assert.equal(context.postCompletionDirective, undefined);
  });

  it('omits pacing directives for completed lessons even past target', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      { status: 'completed', progress: 10, activitiesCompleted: 25 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.pacingDirective, undefined);
    assert.ok(context.postCompletionDirective);
  });

  it('still emits pacing directives for active lessons over target', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      { status: 'active', progress: 6, activitiesCompleted: 15 },
      'Learner profile summary',
      'Alex'
    ));

    assert.ok(context.pacingDirective);
    assert.equal(context.postCompletionDirective, undefined);
  });

  // Placement (#408): the server inlines the unit (stored as
  // `lesson.course`, also sent as `lesson.unit`) and its course
  // (`lesson.program`). buildContext surfaces just the names to the coach, as
  // `unit` and `course`. Lessons outside a unit produce neither key, so the
  // prompt contract for unplaced lessons doesn't change.
  const ctx = (lesson, note) => JSON.parse(buildContext(
    lesson,
    { status: 'active', progress: 2, activitiesCompleted: 3 },
    'Learner profile summary',
    'Alex',
    note,
  ));
  const placed = () => ({
    ...sampleLesson(),
    course: { id: 'course-abc', name: 'AI Foundations' },
    unit: { id: 'course-abc', name: 'AI Foundations', position: 0, lessonPosition: 1 },
    program: { id: 'prog-default', name: 'AI Leaders', position: 0 },
  });

  it('includes unit.name and course.name when the lesson is placed', () => {
    const context = ctx(placed());
    assert.deepEqual(context.unit, { name: 'AI Foundations' });
    assert.deepEqual(context.course, { name: 'AI Leaders' });
  });

  it('falls back to the legacy lesson.course for the unit name, with no course', () => {
    const lesson = sampleLesson();
    lesson.course = { id: 'course-abc', name: 'AI Foundations' };
    const context = ctx(lesson);
    assert.deepEqual(context.unit, { name: 'AI Foundations' });
    assert.equal('course' in context, false, 'a unit outside any course emits no course key');
  });

  it('omits unit and course entirely when the lesson is not in a unit', () => {
    const context = ctx(sampleLesson());
    assert.equal('unit' in context, false);
    assert.equal('course' in context, false);
  });

  // Cross-lesson progress: a distilled, per-learner note of what they've
  // demonstrated elsewhere in the unit (courseProgress:<unitId>), passed as the
  // 5th arg and surfaced as unit.progress so the coach can connect threads.
  it('attaches unit.progress when a cross-lesson note is provided', () => {
    const context = ctx(placed(), 'Completed Lesson B; wrote a clear system prompt.');
    assert.equal(context.unit.name, 'AI Foundations');
    assert.equal(context.unit.progress, 'Completed Lesson B; wrote a clear system prompt.');
    assert.deepEqual(context.course, { name: 'AI Leaders' }, 'the note never lands on course');
  });

  it('omits unit.progress when no cross-lesson note is provided', () => {
    assert.deepEqual(ctx(placed()).unit, { name: 'AI Foundations' });
  });

  it('does not attach a progress note when the lesson has no unit', () => {
    const context = ctx(sampleLesson(), 'Some stray progress note.');
    assert.equal('unit' in context, false, 'no progress note without a unit');
  });

  // Coach directive: author-supplied runtime guidance baked into the lesson
  // markdown (`## Coach Directive`). buildContext surfaces it verbatim so the
  // coach can follow it; absent directives produce no key.
  it('surfaces a coach directive verbatim when the lesson has one', () => {
    const lesson = sampleLesson();
    lesson.coachDirective = 'Reference the learner\'s portfolio project throughout. Share code "ABC123" if asked.';
    const context = JSON.parse(buildContext(
      lesson,
      { status: 'active', progress: 2, activitiesCompleted: 3 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.coachDirective, lesson.coachDirective);
  });

  it('surfaces the coach directive even in completed feedback mode', () => {
    const lesson = sampleLesson();
    lesson.coachDirective = 'Offer the follow-up resource at https://example.com/next';
    const context = JSON.parse(buildContext(
      lesson,
      { status: 'completed', progress: 10, activitiesCompleted: 12 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal(context.coachDirective, lesson.coachDirective);
    assert.ok(context.postCompletionDirective);
  });

  it('omits coachDirective entirely when the lesson has none', () => {
    const context = JSON.parse(buildContext(
      sampleLesson(),
      { status: 'active', progress: 2, activitiesCompleted: 3 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal('coachDirective' in context, false);
  });

  it('omits course when lesson.course exists but has no name (defensive)', () => {
    const lesson = sampleLesson();
    lesson.course = { id: 'course-broken' }; // server returned a malformed inline
    const context = JSON.parse(buildContext(
      lesson,
      { status: 'active', progress: 2, activitiesCompleted: 3 },
      'Learner profile summary',
      'Alex'
    ));

    assert.equal('course' in context, false);
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

  it('freezes progress once the lesson is complete', () => {
    // A completed thread is feedback-only. The coach prompt says not to award
    // progress there, but compliance varies by model, so the freeze is in code.
    const prev = completedKB();
    for (const progress of [9, 10, 3, 0]) {
      const result = applyCoachResponseToKB(
        prev,
        { progress, kbUpdate: null, profileUpdate: null },
        { now: () => 1_700_000_000_000 }
      );
      assert.equal(result.lessonKB.progress, prev.progress);
      assert.equal(result.achieved, false);
      assert.equal(result.phase, LESSON_PHASES.COMPLETED);
    }
  });

  it('still records KB updates in the post-completion feedback thread', () => {
    // Freezing progress must not freeze insight capture — post-completion
    // feedback is the point of that thread.
    const result = applyCoachResponseToKB(
      completedKB(),
      {
        progress: 10,
        kbUpdate: { insights: ['found the pacing slow'], learnerPosition: 'Gave feedback' },
        profileUpdate: null,
      },
      { now: () => 1_700_000_000_000 }
    );

    assert.deepEqual(result.lessonKB.insights, ['found the pacing slow']);
    assert.equal(result.lessonKB.learnerPosition, 'Gave feedback');
  });

  it('clamps an out-of-range progress score', () => {
    const over = applyCoachResponseToKB(
      activeKB(),
      { progress: 47, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );
    assert.equal(over.lessonKB.progress, 10);
    assert.equal(over.achieved, true);

    const under = applyCoachResponseToKB(
      activeKB(),
      { progress: -5, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );
    assert.equal(under.lessonKB.progress, 0);
    assert.equal(under.achieved, false);
  });

  it('ignores a non-numeric progress score without completing the lesson', () => {
    const prev = activeKB();
    const result = applyCoachResponseToKB(
      prev,
      { progress: 'ten', kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.lessonKB.progress, prev.progress);
    assert.equal(result.achieved, false);
    assert.equal(result.phase, LESSON_PHASES.LEARNING);
  });

  it('leaves progress untouched when no score is reported', () => {
    const prev = activeKB();
    const result = applyCoachResponseToKB(
      prev,
      { progress: null, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.lessonKB.progress, prev.progress);
    assert.equal(result.achieved, false);
  });

  it('returns LEARNING phase for active lessons below progress 10', () => {
    const result = applyCoachResponseToKB(
      activeKB(),
      { progress: 6, kbUpdate: null, profileUpdate: null },
      { now: () => 1_700_000_000_000 }
    );

    assert.equal(result.achieved, false);
    assert.equal(result.phase, LESSON_PHASES.LEARNING);
    assert.equal(result.lessonKB.activitiesCompleted, 9);
  });
});

describe('openingProgress', () => {
  it('clamps the opener and never lets it complete a lesson', () => {
    assert.equal(openingProgress(1), 1);
    assert.equal(openingProgress(10), 9);
    assert.equal(openingProgress(999), 9);
    assert.equal(openingProgress(-3), 0);
    assert.equal(openingProgress(null), null);
  });
});
