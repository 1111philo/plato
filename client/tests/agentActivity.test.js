/**
 * "Behind this response" activity (#411, src/lib/agentActivity.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coachTurnActivity, lessonStartActivity, authoringActivity, activitySummary, entry } from '../src/lib/agentActivity.js';

describe('coachTurnActivity', () => {
  it('reports progress, notes, and the profile hand-off', () => {
    const agents = coachTurnActivity({
      before: { progress: 3, status: 'active' }, after: { progress: 6, status: 'active' },
      parsed: { kbUpdate: { insights: ['Gave a concrete example'], learnerPosition: 'Can state the role' } },
      images: 1, hasUnitNote: true,
    });
    assert.deepEqual(agents.map((a) => a.agent), ['coach', 'learner-profile-update']);
    assert.deepEqual(agents[0].did, ['Progress 3 → 6 of 10']);
    assert.deepEqual(agents[0].notes, ['Gave a concrete example', 'Where you are: Can state the role']);
    assert.ok(agents[0].read.includes('1 image you attached'));
    assert.ok(agents[0].read.includes('What you did in other lessons of this unit'));
    assert.deepEqual(agents[1].notes, ['Gave a concrete example']);
  });

  it('prefers an explicit profile observation', () => {
    const [, profile] = coachTurnActivity({ before: { progress: 1 }, after: { progress: 1 }, parsed: { profileUpdate: { observation: 'Prefers examples' }, kbUpdate: { insights: ['x'] } } });
    assert.deepEqual(profile.notes, ['Prefers examples']);
  });

  it('on completion, hands off to the profile and unit progress agents', () => {
    const agents = coachTurnActivity({ before: { progress: 8 }, after: { progress: 10 }, parsed: {}, achieved: true, unitName: 'Prompting Basics' });
    assert.deepEqual(agents[0].did, ['Marked the lesson complete']);
    assert.deepEqual(agents.map((a) => a.agent), ['coach', 'learner-profile-update', 'course-progress-update']);
    assert.match(agents[2].did[0], /Prompting Basics/);
  });

  it('after completion the thread is feedback only', () => {
    const [coach] = coachTurnActivity({ before: { progress: 10, status: 'completed' }, after: { progress: 10, status: 'completed' }, parsed: {} });
    assert.deepEqual(coach.did, ['Gave feedback (the lesson was already complete)']);
  });

  it('clips long notes and caps their number', () => {
    const insights = Array.from({ length: 9 }, (_, i) => `${i} ${'x'.repeat(400)}`);
    const [coach] = coachTurnActivity({ before: {}, after: { progress: 2 }, parsed: { kbUpdate: { insights } } });
    assert.equal(coach.notes.length, 5);
    assert.ok(coach.notes.every((n) => n.length <= 280 && n.endsWith('…')));
  });
});

describe('lessonStartActivity', () => {
  it('lists the planner, plugins, and coach', () => {
    const agents = lessonStartActivity({ lessonKB: { objectives: [{}, {}], learnerPosition: 'New' }, enrichments: [{ label: 'WP docs' }] });
    assert.deepEqual(agents.map((a) => a.label), ['Lesson planner', 'Plugins', 'Coach']);
    assert.deepEqual(agents[0].did, ["Planned how you'll show 2 objectives"]);
    assert.deepEqual(agents[1].did, ['Added reference material: WP docs']);
  });
});

describe('authoringActivity / summary / entry', () => {
  it('reports readiness changes', () => {
    assert.deepEqual(authoringActivity('lesson-creator', { before: 2, after: 4, reads: ['Your conversation'] })[0].did, ['Readiness 2 → 4 of 10']);
    assert.equal(authoringActivity('lesson-creator', { before: 4, after: null })[0].did, undefined);
  });
  it('summarizes distinct labels in order', () => {
    assert.equal(activitySummary([entry('coach'), entry('learner-profile-update'), entry('learner-profile-update')]), 'Coach, Learner profile');
  });
  it('drops empty lists', () => {
    assert.deepEqual(entry('coach', { did: [null, ''] }), { agent: 'coach', label: 'Coach' });
  });
});
