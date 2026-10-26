/**
 * Course completion counts on the learner's lesson list (#395).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { courseCompletion, groupByCourse } from '../src/lib/courseCompletion.js';

const A = { id: 'c_a', name: 'Alpha' };
const B = { id: 'c_b', name: 'Beta' };
const lessons = [
  { lessonId: 'a1', course: A }, { lessonId: 'a2', course: A }, { lessonId: 'a3', course: A },
  { lessonId: 'b1', course: B },
  { lessonId: 'custom-x', course: A },
  { lessonId: 'loose' },
];
const data = { a1: { status: 'completed' }, a2: { status: 'active' }, b1: { status: 'completed' }, 'custom-x': { status: 'completed' } };

describe('courseCompletion', () => {
  it('counts completed / total per course', () => {
    assert.deepEqual(courseCompletion(lessons, data), { c_a: { completed: 1, total: 3 }, c_b: { completed: 1, total: 1 } });
  });

  it('excludes custom lessons and lessons without a course', () => {
    const c = courseCompletion(lessons, data);
    assert.equal(c.c_a.total, 3, 'custom-x not counted');
    assert.equal(Object.keys(c).length, 2, 'no bucket for course-less lessons');
  });

  it('does not depend on which lessons are visible', () => {
    // The page passes ALL lessons, so filtering the grid can't change the counts.
    const notStarted = lessons.filter((l) => !data[l.lessonId]);
    assert.deepEqual(courseCompletion(lessons, data).c_a, { completed: 1, total: 3 });
    assert.notDeepEqual(courseCompletion(notStarted, data).c_a, courseCompletion(lessons, data).c_a);
  });
});

describe('groupByCourse', () => {
  it('splits a sorted list into runs by course', () => {
    const groups = groupByCourse([lessons[0], lessons[1], lessons[3], lessons[5]]);
    assert.deepEqual(groups.map((g) => [g.courseId, g.courseName, g.lessons.length]), [
      ['c_a', 'Alpha', 2], ['c_b', 'Beta', 1], [null, null, 1],
    ]);
  });

  it('is empty for no lessons', () => {
    assert.deepEqual(groupByCourse([]), []);
  });
});
