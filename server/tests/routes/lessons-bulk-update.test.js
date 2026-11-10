/**
 * POST /v1/admin/lessons/bulk-update (#526): one visibility change for many
 * lessons, with the single-lesson PUT's rules and everything else kept.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const MD = '# L\n\nDesc\n\n## Exemplar\n\nDo it\n\n## Learning Objectives\n\n- Can do A\n- Can do B';
const ROLES = { usr_admin: 'admin', usr_ed: 'educator', usr_test: 'tester', usr_l1: 'learner', usr_l2: 'learner' };
let lessons, puts, audits;

async function bulk(body, as = 'usr_admin') {
  const token = await signAccessToken(as, ROLES[as]);
  const app = new Hono();
  app.route('/', admin);
  return app.request('/v1/admin/lessons/bulk-update', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
}

beforeEach(() => {
  lessons = {
    a: { version: 1, data: { name: 'A', status: 'private', markdown: MD, sharedWith: ['usr_l1'], course: 'u1', isBuiltIn: true, bundled: { id: 'x' } } },
    b: { version: 3, data: { name: 'B', status: 'public', markdown: MD, sharedWith: [], publishedAt: '2026-01-01T00:00:00.000Z' } },
    d: { version: 1, data: { name: 'Draft', status: 'draft', markdown: '' } },
    bad: { version: 1, data: { name: 'Bad', status: 'private', markdown: '# Bad\n\nno objectives' } },
  };
  puts = []; audits = [];
  db.getUserById = async (id) => (ROLES[id] ? { userId: id, role: ROLES[id], email: `${id}@x.com` } : null);
  db.listAllUsers = async () => Object.keys(ROLES).map((userId) => ({ userId }));
  db.getAllSyncData = async (u) => (u === '_system' ? Object.entries(lessons).map(([id, l]) => ({ dataKey: `lesson:${id}`, ...l })) : []);
  db.putSyncData = async (_u, key, data, version) => {
    const id = key.slice('lesson:'.length);
    if (lessons[id].version !== version) throw Object.assign(new Error('Version mismatch'), { name: 'ConditionalCheckFailedException' });
    lessons[id] = { version: version + 1, data };
    puts.push(id);
  };
  db.createAuditLog = async (a) => { audits.push(a); };
});

describe('bulk lesson update', () => {
  it('makes lessons private and adds people to who they’re shared with, keeping everything else', async () => {
    const res = await bulk({ lessonIds: ['a', 'b'], status: 'private', share: { mode: 'add', userIds: ['usr_l2'] } });
    assert.deepEqual(await res.json(), { updated: 2, unchanged: 0, failed: [] });
    assert.deepEqual(lessons.a.data.sharedWith, ['usr_l1', 'usr_l2']);
    assert.deepEqual(lessons.b.data.sharedWith, ['usr_l2']);
    assert.equal(lessons.b.data.status, 'private');
    assert.equal(lessons.a.data.course, 'u1');
    assert.equal(lessons.a.data.isBuiltIn, true, 'the single PUT resets this; bulk keeps it');
    assert.deepEqual(lessons.a.data.bundled, { id: 'x' });
    assert.equal(lessons.a.data.updatedBy, 'usr_admin');
    assert.equal(audits[0].action, 'lessons_bulk_updated');
    assert.deepEqual(audits[0].details, { status: 'private', share: { mode: 'add', count: 1 }, count: 2, failed: 0 });
  });

  it('replace shares with only those people', async () => {
    await bulk({ lessonIds: ['a'], status: 'private', share: { mode: 'replace', userIds: ['usr_l2'] } });
    assert.deepEqual(lessons.a.data.sharedWith, ['usr_l2']);
  });

  it('going public validates the lesson, stamps publishedAt once, and empties sharing', async () => {
    const res = await bulk({ lessonIds: ['a', 'b', 'bad'], status: 'public' });
    const r = await res.json();
    assert.equal(r.updated, 1);
    assert.equal(r.unchanged, 1, 'b was already public');
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0].lessonId, 'bad');
    assert.match(r.failed[0].error, /Learning Objectives/);
    assert.equal(lessons.a.data.status, 'public');
    assert.deepEqual(lessons.a.data.sharedWith, []);
    assert.ok(lessons.a.data.publishedAt);
    assert.equal(lessons.b.data.publishedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(lessons.bad.data.status, 'private');
  });

  it('refuses drafts and unknown lessons, and reports a lesson changed since the read', async () => {
    const realPut = db.putSyncData;
    db.putSyncData = async (u, key, data, version) => { if (key === 'lesson:a') lessons.a.version++; return realPut(u, key, data, version); };
    const r = await (await bulk({ lessonIds: ['d', 'nope', 'a'], status: 'private', share: { mode: 'add', userIds: ['usr_l2'] } })).json();
    assert.equal(r.updated, 0);
    assert.deepEqual(r.failed.map((f) => [f.lessonId, f.error]), [
      ['d', 'Still a draft: finish creating it first'],
      ['nope', 'Lesson not found'],
      ['a', 'Changed by someone else; try again'],
    ]);
    assert.equal(lessons.d.data.status, 'draft');
  });

  it('validates the request before touching anything', async () => {
    for (const body of [
      { lessonIds: [], status: 'private' },
      { lessonIds: ['a'], status: 'draft' },
      { lessonIds: ['a'], status: 'public', share: { mode: 'add', userIds: ['usr_l1'] } },
      { lessonIds: ['a'], status: 'private', share: { mode: 'merge', userIds: [] } },
      { lessonIds: ['a'], status: 'private', share: { mode: 'add', userIds: ['usr_ghost'] } },
      { lessonIds: Array.from({ length: 501 }, (_, i) => `l${i}`), status: 'private' },
    ]) assert.equal((await bulk(body)).status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(puts.length, 0);
  });

  it('educators can; testers and learners can’t', async () => {
    assert.equal((await bulk({ lessonIds: ['a'], status: 'public' }, 'usr_ed')).status, 200);
    assert.equal((await bulk({ lessonIds: ['b'], status: 'private' }, 'usr_test')).status, 403);
    assert.equal((await bulk({ lessonIds: ['b'], status: 'private' }, 'usr_l1')).status, 403);
  });
});
