/**
 * POST /v1/admin/users/bulk-update: one change (group or a custom field) for
 * many users. Validated once, applied per user, one audit entry.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const FIELDS = [
  { id: 'fld_org', label: 'Organization', type: 'text', required: true },
  { id: 'fld_role', label: 'Role', type: 'dropdown', required: false, options: ['Teacher', 'Student'] },
];
let users, updates, audits;

async function bulk(body, role = 'admin') {
  const token = await signAccessToken(role === 'admin' ? 'usr_admin' : 'usr_ed', role);
  const app = new Hono();
  app.route('/', admin);
  return app.request('/v1/admin/users/bulk-update', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
}

beforeEach(() => {
  users = {
    usr_a: { userId: 'usr_a', role: 'learner', userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } },
    usr_b: { userId: 'usr_b', role: 'learner', userGroup: null, customFields: { fld_org: 'Loyola', fld_role: 'Teacher' } },
    usr_admin: { userId: 'usr_admin', role: 'admin', name: 'Admin' },
    usr_ed: { userId: 'usr_ed', role: 'educator', name: 'Ed' },
  };
  updates = []; audits = [];
  db.getSyncData = async (_u, key) => (key === 'settings' ? { data: { userGroups: ['Cohort A', 'Cohort B'], userFields: FIELDS } } : null);
  db.getUserById = async (id) => users[id] || null;
  db.updateUser = async (id, u) => { updates.push([id, u]); users[id] = { ...users[id], ...u }; };
  db.createAuditLog = async (a) => { audits.push(a); };
});

describe('bulk user update', () => {
  it('sets a group for everyone selected, skipping those already in it', async () => {
    const res = await bulk({ userIds: ['usr_a', 'usr_b'], set: { field: 'userGroup', value: 'Cohort A' } });
    assert.deepEqual(await res.json(), { updated: 1, unchanged: 1, failed: [] });
    assert.deepEqual(updates, [['usr_b', { userGroup: 'Cohort A' }]]);
    assert.equal(audits[0].action, 'users_bulk_updated');
    assert.deepEqual(audits[0].details, { field: 'userGroup', label: 'Group', cleared: false, count: 1, failed: 0 });
  });

  it('clears a group, sets and clears a field, keeping every other field', async () => {
    await bulk({ userIds: ['usr_a'], set: { field: 'userGroup', value: null } });
    assert.equal(users.usr_a.userGroup, null);
    await bulk({ userIds: ['usr_a', 'usr_b'], set: { field: 'fld_role', value: 'Student' } });
    assert.deepEqual(users.usr_b.customFields, { fld_org: 'Loyola', fld_role: 'Student' });
    const res = await bulk({ userIds: ['usr_a', 'usr_b'], set: { field: 'fld_role', value: '' } });
    assert.deepEqual((await res.json()).updated, 2);
    assert.deepEqual(users.usr_a.customFields, { fld_org: 'UIC' });
    assert.deepEqual(users.usr_b.customFields, { fld_org: 'Loyola' });
  });

  it('clearing a required field is allowed (those learners are asked again)', async () => {
    const res = await bulk({ userIds: ['usr_a'], set: { field: 'fld_org', value: '' } });
    assert.equal((await res.json()).updated, 1);
    assert.deepEqual(users.usr_a.customFields, {});
  });

  it('validates the change once, before touching anyone', async () => {
    for (const set of [{ field: 'userGroup', value: 'Nope' }, { field: 'fld_role', value: 'Pilot' }, { field: 'fld_gone', value: 'x' }, { field: 'role', value: 'admin' }, { field: 'fld_org', value: 5 }]) {
      assert.equal((await bulk({ userIds: ['usr_a'], set })).status, 400, JSON.stringify(set));
    }
    assert.equal((await bulk({ userIds: [], set: { field: 'userGroup', value: 'Cohort A' } })).status, 400);
    assert.equal((await bulk({ userIds: Array.from({ length: 1001 }, (_, i) => `usr_${i}`), set: { field: 'userGroup', value: 'Cohort A' } })).status, 400);
    assert.deepEqual(updates, []);
  });

  it('reports unknown users and keeps going', async () => {
    const res = await bulk({ userIds: ['usr_x', 'usr_b'], set: { field: 'userGroup', value: 'Cohort B' } });
    assert.deepEqual(await res.json(), { updated: 1, unchanged: 0, failed: [{ userId: 'usr_x', error: 'User not found' }] });
  });

  it('is admin-only (educators can’t edit users)', async () => {
    assert.equal((await bulk({ userIds: ['usr_a'], set: { field: 'userGroup', value: 'Cohort B' } }, 'educator')).status, 403);
    assert.deepEqual(updates, []);
  });
});
