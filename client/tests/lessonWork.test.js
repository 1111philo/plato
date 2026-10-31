/**
 * Lesson work view helpers (#438, src/lib/lessonWork.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObjectivesMet, objectiveStatuses, objectivesMetForContext, collectArtifacts } from '../src/lib/lessonWork.js';

const kb = (over = {}) => ({ status: 'active', objectives: [{ objective: 'A' }, { objective: 'B' }, { objective: 'C' }], ...over });

describe('mergeObjectivesMet', () => {
  it('adds 1-based numbers, stored 0-based and sorted', () => {
    assert.deepEqual(mergeObjectivesMet(kb(), { objectivesMet: [3, 1] }).objectivesMet, [0, 2]);
  });
  it('is one way: a met objective stays met when later turns omit it', () => {
    const k = mergeObjectivesMet(kb({ objectivesMet: [0, 2] }), { objectivesMet: [2] });
    assert.deepEqual(k.objectivesMet, [0, 1, 2]);
  });
  it('ignores out-of-range, non-integer, and missing values; returns the same KB when nothing changes', () => {
    const k = kb({ objectivesMet: [1] });
    assert.equal(mergeObjectivesMet(k, { objectivesMet: [0, 4, 1.5, 'x', 2] }), k);
    assert.equal(mergeObjectivesMet(k, {}), k);
    assert.equal(mergeObjectivesMet(k, null), k);
  });
  it('leaves a completed lesson alone', () => {
    const k = kb({ status: 'completed' });
    assert.equal(mergeObjectivesMet(k, { objectivesMet: [1] }), k);
  });
});

describe('objectiveStatuses', () => {
  it('marks met objectives, and every objective once complete', () => {
    assert.deepEqual(objectiveStatuses(kb({ objectivesMet: [1] })).map((o) => o.met), [false, true, false]);
    assert.deepEqual(objectiveStatuses(kb({ status: 'completed' })).map((o) => o.met), [true, true, true]);
  });
  it('falls back to the lesson objectives before a KB exists', () => {
    assert.deepEqual(objectiveStatuses(null, ['X', 'Y']), [{ objective: 'X', met: false }, { objective: 'Y', met: false }]);
  });
});

describe('objectivesMetForContext', () => {
  it('is 1-based, or undefined when none are met', () => {
    assert.deepEqual(objectivesMetForContext(kb({ objectivesMet: [0, 2] })), [1, 3]);
    assert.equal(objectivesMetForContext(kb()), undefined);
  });
});

describe('collectArtifacts', () => {
  it('lists the learner’s images (by key) and links, oldest first, skipping the coach', () => {
    const messages = [
      { role: 'assistant', metadata: { agents: [] } },
      { role: 'user', timestamp: 1, metadata: { imageKeys: ['screenshot:a', 'screenshot:b'] } },
      { role: 'user', timestamp: 2, metadata: { links: [{ url: 'https://x.org', title: 'X' }], imageDataUrls: ['data:1'] } },
      { role: 'user', timestamp: 3, metadata: null },
    ];
    assert.deepEqual(collectArtifacts(messages), [
      { kind: 'image', key: 'screenshot:a', dataUrl: null, at: 1 },
      { kind: 'image', key: 'screenshot:b', dataUrl: null, at: 1 },
      { kind: 'image', key: null, dataUrl: 'data:1', at: 2 },
      { kind: 'link', url: 'https://x.org', title: 'X', at: 2 },
    ]);
  });
});
