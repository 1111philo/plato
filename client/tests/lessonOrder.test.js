/**
 * Learner-side hierarchy order (#408, src/lib/lessonOrder.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareLessons, sortLessons, nextLessonAfter, groupForDisplay, completionBy } from '../src/lib/lessonOrder.js';

const P1 = { id: 'p1', name: 'Course One', position: 0 };
const P2 = { id: 'p2', name: 'Course Two', position: 1 };
const L = (lessonId, name, program, unit) => ({ lessonId, name, program, unit });
const lessons = [
  L('c1', 'Zed', P1, { id: 'u2', name: 'Unit B', position: 1, lessonPosition: 0 }),
  L('a2', 'Alpha 2', P1, { id: 'u1', name: 'Unit A', position: 0, lessonPosition: 1 }),
  L('a1', 'Alpha 10', P1, { id: 'u1', name: 'Unit A', position: 0, lessonPosition: 0 }),
  L('d1', 'Delta', P2, { id: 'u3', name: 'Unit C', position: 0, lessonPosition: 0 }),
  L('e1', 'Loose B', null, { id: 'u9', name: 'Loose Unit', position: null, lessonPosition: 1 }),
  L('e0', 'Loose A', null, { id: 'u9', name: 'Loose Unit', position: null, lessonPosition: 0 }),
  L('custom-x', 'My Lesson', null, null),
  L('n1', 'No Unit', null, null),
];

describe('sortLessons', () => {
  it('orders by course, then unit position, then lesson position, with loose units and loose lessons last', () => {
    assert.deepEqual(sortLessons(lessons).map((l) => l.lessonId), ['a1', 'a2', 'c1', 'd1', 'e0', 'e1', 'custom-x', 'n1']);
  });
  it('uses position, not name, inside a unit ("Alpha 10" before "Alpha 2")', () => {
    assert.ok(compareLessons(lessons[2], lessons[1]) < 0);
  });
});

describe('nextLessonAfter', () => {
  it('continues within the unit, then into the next unit of the same course', () => {
    assert.equal(nextLessonAfter(lessons, 'a1').lessonId, 'a2');
    assert.equal(nextLessonAfter(lessons, 'a2').lessonId, 'c1');
  });
  it('stops at the end of the course (never jumps to another course)', () => {
    assert.equal(nextLessonAfter(lessons, 'c1'), null);
  });
  it('a unit outside any course continues within that unit only', () => {
    assert.equal(nextLessonAfter(lessons, 'e0').lessonId, 'e1');
    assert.equal(nextLessonAfter(lessons, 'e1'), null);
  });
  it('lessons outside any unit, and unknown ids, have no next lesson', () => {
    assert.equal(nextLessonAfter(lessons, 'n1'), null);
    assert.equal(nextLessonAfter(lessons, 'nope'), null);
  });
});

describe('groupForDisplay', () => {
  it('groups a sorted page into course and unit runs', () => {
    const groups = groupForDisplay(sortLessons(lessons));
    assert.deepEqual(groups.map((g) => [g.key, g.units.map((u) => [u.key, u.lessons.length])]), [
      ['p1', [['u1', 2], ['u2', 1]]],
      ['p2', [['u3', 1]]],
      ['units-without-course', [['u9', 2]]],
      ['other', [['no-unit', 2]]],
    ]);
  });
});

describe('completionBy', () => {
  const data = { a1: { status: 'completed' }, c1: { status: 'active' }, e0: { status: 'completed' }, 'custom-x': { status: 'completed' } };
  it('counts completed / total per course, excluding custom lessons and lessons outside a course', () => {
    assert.deepEqual(completionBy('program', lessons, data), { p1: { completed: 1, total: 3 }, p2: { completed: 0, total: 1 } });
  });
  it('counts per unit', () => {
    assert.deepEqual(completionBy('unit', lessons, data), {
      u1: { completed: 1, total: 2 }, u2: { completed: 0, total: 1 }, u3: { completed: 0, total: 1 }, u9: { completed: 1, total: 2 },
    });
  });
  it('does not depend on which lessons are visible (#395)', () => {
    const notStarted = lessons.filter((l) => !data[l.lessonId]);
    assert.notDeepEqual(completionBy('program', notStarted, data).p1, completionBy('program', lessons, data).p1);
  });
});
