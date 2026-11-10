/**
 * Admin → Lessons filters (#527, src/lib/lessonFilters.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonFacets } from '../src/lib/lessonFilters.js';
import { describeFilters } from '../src/lib/userFilters.js';

const units = [
  { unitId: 'u1', name: 'Basics', programId: 'p1' },
  { courseId: 'u2', name: 'Leading', programId: 'p2' }, // legacy id field
];
const programs = [{ programId: 'p1', name: 'Foundations' }, { programId: 'p2', name: 'AI Leadership' }];
const lessons = [
  { lessonId: 'a', status: 'public', course: 'u1', createdByName: 'blake' },
  { lessonId: 'b', status: 'private', course: 'u2', createdByName: 'stef' },
  { lessonId: 'c', status: 'draft', course: null, createdByName: 'stef' },
  { lessonId: 'd', status: 'public', course: 'u2' },
];
const { facets, match } = buildLessonFacets({ lessons, units, programs });
const pick = (filters) => lessons.filter((l) => match(l, filters)).map((l) => l.lessonId);
const count = (key, value) => facets.find((f) => f.key === key).options.find((o) => o.value === value).count;

describe('lesson filters', () => {
  it('offers status, course, unit, and created by, with counts', () => {
    assert.deepEqual(facets.map((f) => f.key), ['status', 'course', 'unit', 'createdBy']);
    assert.equal(count('status', 'public'), 2);
    assert.equal(count('course', 'p2'), 2, 'a course counts the lessons in its units');
    assert.equal(count('course', '__none'), 1);
    assert.equal(count('unit', 'u2'), 2);
    assert.deepEqual(facets.find((f) => f.key === 'createdBy').options.map((o) => o.label), ['blake', 'stef']);
    assert.equal(facets.find((f) => f.key === 'unit').options[0].label, 'Foundations › Basics');
  });

  it('OR within a facet, AND across facets', () => {
    assert.deepEqual(pick({}), ['a', 'b', 'c', 'd']);
    assert.deepEqual(pick({ course: ['p2'] }), ['b', 'd']);
    assert.deepEqual(pick({ course: ['p2'], status: ['public'] }), ['d']);
    assert.deepEqual(pick({ status: ['public', 'draft'] }), ['a', 'c', 'd']);
    assert.deepEqual(pick({ unit: ['__none'] }), ['c']);
    assert.deepEqual(pick({ createdBy: ['stef'], status: ['private'] }), ['b']);
  });

  it('chips name the facet and the chosen options', () => {
    assert.deepEqual(describeFilters({ course: ['p1'] }, facets), [{ key: 'course', label: 'Course', values: ['Foundations'] }]);
  });

  it('skips facets with nothing to choose', () => {
    const bare = buildLessonFacets({ lessons: [{ lessonId: 'x', status: 'public' }] });
    assert.deepEqual(bare.facets.map((f) => f.key), ['status']);
    const one = buildLessonFacets({ lessons, units: [units[0]], programs: [programs[0]] });
    assert.equal(one.facets.find((f) => f.key === 'unit').options[0].label, 'Basics', 'one course: no prefix');
  });
});
