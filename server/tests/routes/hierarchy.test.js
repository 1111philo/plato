/**
 * Course / Unit admin routes (#408, src/routes/admin-hierarchy.js) against an
 * in-memory _system store with real version checks.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import content from '../../src/routes/content.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

let store;
const conflict = () => Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
beforeEach(() => {
  store = new Map();
  const put = (k, data, v) => store.set(k, { dataKey: k.split(':').slice(1).join(':'), data: structuredClone(data), version: v, updatedAt: 'now' });
  const seed = (k, data) => put(`_system:${k}`, data, 1);
  seed('program:p1', { name: 'Course One', unitIds: ['u1'] });
  seed('course:u1', { name: 'Unit A', programId: 'p1', lessonIds: ['l1', 'l2'] });
  seed('course:u2', { name: 'Unit B', programId: null });
  seed('lesson:l1', { name: 'Lesson 1', course: 'u1', status: 'public', markdown: '# L1' });
  seed('lesson:l2', { name: 'Lesson 2', course: 'u1', status: 'public', markdown: '# L2' });
  seed('lesson:l3', { name: 'Lesson 3', course: 'u2', status: 'public', markdown: '# L3' });
  db.getUserById = async (id) => ({ userId: id, role: id === 'usr_admin' ? 'admin' : 'user', username: id });
  db.getAllSyncData = async (u) => [...store.entries()].filter(([k]) => k.startsWith(`${u}:`)).map(([, v]) => structuredClone(v));
  db.getSyncData = async (u, k) => structuredClone(store.get(`${u}:${k}`) || null);
  db.putSyncData = async (u, k, data, ev) => {
    const cur = store.get(`${u}:${k}`);
    if (ev && cur && cur.version !== ev) throw conflict();
    put(`${u}:${k}`, data, (ev || 0) + 1);
    return { version: (ev || 0) + 1 };
  };
  db.deleteSyncData = async (u, k) => { store.delete(`${u}:${k}`); };
});
const rec = (k) => store.get(`_system:${k}`)?.data;

async function req(method, path, body, userId = 'usr_admin', app = admin) {
  const a = new Hono(); a.route('/', app);
  const token = await signAccessToken(userId, 'admin');
  return a.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
}

describe('units', () => {
  it('lists units with course, position, and ordered lessons', async () => {
    const units = await (await req('GET', '/v1/admin/units')).json();
    const a = units.find((u) => u.unitId === 'u1');
    assert.deepEqual({ programId: a.programId, position: a.position, lessonIds: a.lessonIds, courseId: a.courseId }, { programId: 'p1', position: 0, lessonIds: ['l1', 'l2'], courseId: 'u1' });
    assert.equal(units.find((u) => u.unitId === 'u2').position, null);
  });

  it('renaming keeps programId and lessonIds (the pre-#408 PUT dropped them)', async () => {
    assert.equal((await req('PUT', '/v1/admin/units/u1', { name: 'Unit Alpha' })).status, 200);
    assert.deepEqual({ name: rec('course:u1').name, programId: rec('course:u1').programId, lessonIds: rec('course:u1').lessonIds }, { name: 'Unit Alpha', programId: 'p1', lessonIds: ['l1', 'l2'] });
  });

  it('the legacy /courses alias still works', async () => {
    assert.equal((await req('PUT', '/v1/admin/courses/u2', { name: 'Unit Beta' })).status, 200);
    assert.equal(rec('course:u2').name, 'Unit Beta');
    assert.equal((await (await req('GET', '/v1/admin/courses')).json()).length, 2);
  });

  it('moving a unit into a course appends it to that course order', async () => {
    assert.equal((await req('PUT', '/v1/admin/units/u2', { name: 'Unit B', programId: 'p1' })).status, 200);
    assert.deepEqual(rec('program:p1').unitIds, ['u1', 'u2']);
    assert.equal(rec('course:u2').programId, 'p1');
    assert.equal((await req('PUT', '/v1/admin/units/u2', { name: 'Unit B', programId: 'nope' })).status, 400);
  });

  it('reorders lessons only with an exact permutation', async () => {
    assert.equal((await req('PUT', '/v1/admin/units/u1/order', { lessonIds: ['l2', 'l1'] })).status, 200);
    assert.deepEqual(rec('course:u1').lessonIds, ['l2', 'l1']);
    assert.equal((await req('PUT', '/v1/admin/units/u1/order', { lessonIds: ['l2'] })).status, 400);
    assert.equal((await req('PUT', '/v1/admin/units/u1/order', { lessonIds: ['l2', 'l1', 'l3'] })).status, 400);
  });

  it('deleting a unit clears its lessons and removes it from its course', async () => {
    assert.equal((await req('DELETE', '/v1/admin/units/u1')).status, 200);
    assert.equal(rec('lesson:l1').course, null);
    assert.deepEqual(rec('program:p1').unitIds, []);
  });
});

describe('courses (programs)', () => {
  it('creates, lists with counts, and rejects duplicate names', async () => {
    assert.equal((await req('PUT', '/v1/admin/programs/p2', { name: 'Course Two', description: 'About it' })).status, 200);
    const { programs, unassignedUnitIds } = await (await req('GET', '/v1/admin/programs')).json();
    assert.deepEqual(programs.map((p) => [p.programId, p.unitCount, p.lessonCount]), [['p1', 1, 2], ['p2', 0, 0]]);
    assert.deepEqual(unassignedUnitIds, ['u2']);
    assert.equal((await req('PUT', '/v1/admin/programs/p3', { name: 'course one' })).status, 409);
  });

  it('reorders units only with an exact permutation', async () => {
    await req('PUT', '/v1/admin/units/u2', { name: 'Unit B', programId: 'p1' });
    assert.equal((await req('PUT', '/v1/admin/programs/p1/order', { unitIds: ['u2', 'u1'] })).status, 200);
    assert.deepEqual(rec('program:p1').unitIds, ['u2', 'u1']);
    assert.equal((await req('PUT', '/v1/admin/programs/p1/order', { unitIds: ['u2'] })).status, 400);
  });

  it('deleting a course keeps its units, unassigned', async () => {
    assert.equal((await req('DELETE', '/v1/admin/programs/p1')).status, 200);
    assert.equal(rec('program:p1'), undefined);
    assert.equal(rec('course:u1').programId, null);
    assert.equal(rec('course:u1').name, 'Unit A');
  });
});

describe('learner lesson placement', () => {
  it('GET /v1/lessons carries unit and course with positions, and the legacy course field', async () => {
    const lessons = await (await req('GET', '/v1/lessons', null, 'usr_learner', content)).json();
    const l2 = lessons.find((l) => l.lessonId === 'l2');
    assert.deepEqual(l2.unit, { id: 'u1', name: 'Unit A', position: 0, lessonPosition: 1 });
    assert.deepEqual(l2.program, { id: 'p1', name: 'Course One', position: 0 });
    assert.deepEqual(l2.course, { id: 'u1', name: 'Unit A' });
    const l3 = lessons.find((l) => l.lessonId === 'l3');
    assert.equal(l3.program, null, 'unit not in a course');
  });

  it('GET /v1/lessons/:id carries the same placement', async () => {
    const l1 = await (await req('GET', '/v1/lessons/l1', null, 'usr_learner', content)).json();
    assert.deepEqual(l1.unit, { id: 'u1', name: 'Unit A', position: 0, lessonPosition: 0 });
  });
});
