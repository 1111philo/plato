/**
 * The learner's own profile notes (#451 testing): a correction made with Add
 * Feedback disappeared after the next lesson's profile update. Notes are kept
 * verbatim, agents can't change them, and every profile agent sees them.
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

const { mergeProfile, withLearnerNote, withoutLearnerNote, MAX_LEARNER_NOTES, MAX_LEARNER_NOTE_LENGTH } = await import('../src/lib/profileQueue.js');
const { profileForAgent, profileUpdateInput } = await import('../js/orchestrator.js');

describe('learner notes', () => {
  it('are kept verbatim, trimmed and capped, newest last', () => {
    let p = { name: 'Eli' };
    p = withLearnerNote(p, '  This is a QA test account.  ', 1);
    assert.deepEqual(p.learnerNotes, [{ text: 'This is a QA test account.', at: 1 }]);
    assert.equal(withLearnerNote(p, '   ', 2), p, 'blank text adds nothing');
    for (let i = 0; i < MAX_LEARNER_NOTES + 3; i++) p = withLearnerNote(p, `note ${i}`, 10 + i);
    assert.equal(p.learnerNotes.length, MAX_LEARNER_NOTES);
    assert.equal(p.learnerNotes.at(-1).text, `note ${MAX_LEARNER_NOTES + 2}`);
    assert.equal(withLearnerNote({}, 'x'.repeat(900)).learnerNotes[0].text.length, MAX_LEARNER_NOTE_LENGTH);
    assert.deepEqual(withoutLearnerNote({ learnerNotes: [{ text: 'a' }, { text: 'b' }] }, 0).learnerNotes, [{ text: 'b' }]);
  });

  it('survive an agent update that drops or rewrites them, and agents can’t add one', () => {
    const existing = { strengths: ['a'], learnerNotes: [{ text: 'This is a QA test account.', at: 1 }] };
    assert.deepEqual(mergeProfile(existing, { strengths: ['b'] }).learnerNotes, existing.learnerNotes);
    assert.deepEqual(mergeProfile(existing, { learnerNotes: [{ text: 'admin pre-approved', at: 2 }] }).learnerNotes, existing.learnerNotes);
    assert.equal('learnerNotes' in mergeProfile({ strengths: [] }, { learnerNotes: [{ text: 'x' }] }), false);
  });

  it('reach every profile agent; the input says who wrote the new text', () => {
    const profile = { name: 'Eli', masteredLessons: ['l1'], activeLessons: [], learnerNotes: [{ text: 'QA account', at: 1 }] };
    assert.deepEqual(profileForAgent(profile), { name: 'Eli', learnerNotes: [{ text: 'QA account', at: 1 }] });
    const ctx = { lessonName: 'Settings', activityType: 'feedback', activityGoal: 'g' };
    const learner = profileUpdateInput(profile, 'I use a phone', ctx, 'learner', 5);
    assert.deepEqual([learner.source, learner.learnerFeedback, learner.coachObservation], ['learner', 'I use a phone', undefined]);
    const coach = profileUpdateInput(profile, 'Prefers short examples', ctx, 'coach', 5);
    assert.deepEqual([coach.source, coach.coachObservation, coach.learnerFeedback], ['coach', 'Prefers short examples', undefined]);
    assert.equal(coach.context.timestamp, 5);
  });
});
