/**
 * Course → Unit → Lesson ordering (#408, src/lib/hierarchy.js). Order arrays
 * only order: they can never hide or duplicate a member, and a missing or
 * stale array falls back to name order (the pre-#408 behavior).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderIds, buildHierarchy, isPermutation } from '../../src/lib/hierarchy.js';

describe('orderIds', () => {
  const name = (id) => ({ a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta' }[id]);
  it('follows the order array, then appends unlisted members by name', () => {
    assert.deepEqual(orderIds(['c', 'a'], ['a', 'b', 'c', 'd'], name), ['c', 'a', 'b', 'd']);
  });
  it('ignores ids that are no longer members, and duplicates', () => {
    assert.deepEqual(orderIds(['x', 'b', 'b', 'a'], ['a', 'b'], name), ['b', 'a']);
  });
  it('with no array, is plain name order (natural numbers)', () => {
    const n = (id) => ({ l2: 'Lesson 2', l10: 'Lesson 10', l1: 'Lesson 1' }[id]);
    assert.deepEqual(orderIds(undefined, ['l10', 'l2', 'l1'], n), ['l1', 'l2', 'l10']);
  });
});

describe('isPermutation', () => {
  it('accepts exactly the members reordered and nothing else', () => {
    assert.ok(isPermutation(['b', 'a'], ['a', 'b']));
    assert.equal(isPermutation(['a'], ['a', 'b']), false);
    assert.equal(isPermutation(['a', 'a'], ['a', 'b']), false);
    assert.equal(isPermutation(['a', 'c'], ['a', 'b']), false);
    assert.equal(isPermutation('ab', ['a', 'b']), false);
  });
});

describe('buildHierarchy', () => {
  const items = [
    { dataKey: 'program:p1', data: { name: 'Course One', unitIds: ['u2', 'u1'] } },
    { dataKey: 'course:u1', data: { name: 'Unit A', programId: 'p1', lessonIds: ['l2', 'l1'] } },
    { dataKey: 'course:u2', data: { name: 'Unit B', programId: 'p1' } },
    { dataKey: 'course:u3', data: { name: 'Loose Unit', programId: 'p-deleted' } },
    { dataKey: 'lesson:l1', data: { name: 'L1', course: 'u1' } },
    { dataKey: 'lesson:l2', data: { name: 'L2', course: 'u1' } },
    { dataKey: 'lesson:l3', data: { name: 'L3', course: 'u2' } },
    { dataKey: 'lesson:l4', data: { name: 'L4', course: 'u3' } },
    { dataKey: 'lesson:l5', data: { name: 'L5', course: null } },
  ];
  const h = buildHierarchy(items);

  it('orders units in a course and lessons in a unit', () => {
    assert.deepEqual(h.programs.map((p) => [p.id, p.unitIds]), [['p1', ['u2', 'u1']]]);
    assert.deepEqual(h.units.get('u1').lessonIds, ['l2', 'l1']);
  });

  it('places each lesson with its unit and lesson position', () => {
    assert.deepEqual(h.placement.get('l3'), { unitId: 'u2', programId: 'p1', unitPosition: 0, lessonPosition: 0 });
    assert.deepEqual(h.placement.get('l1'), { unitId: 'u1', programId: 'p1', unitPosition: 1, lessonPosition: 1 });
  });

  it('treats a unit whose course was deleted as unassigned', () => {
    assert.equal(h.units.get('u3').programId, null);
    assert.deepEqual(h.unassignedUnitIds, ['u3']);
    assert.deepEqual(h.placement.get('l4'), { unitId: 'u3', programId: null, unitPosition: null, lessonPosition: 0 });
  });

  it('lessons outside any unit have no placement', () => {
    assert.equal(h.placement.get('l5'), undefined);
  });
});
