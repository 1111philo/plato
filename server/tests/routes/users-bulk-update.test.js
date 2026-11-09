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
let users, updates, audits, invites;

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
  invites = {
    wl_1: { inviteToken: 'wl_1', status: 'waitlist', email: 'w1@x.com', profile: { firstName: 'W', userGroup: null, customFields: { fld_org: 'UIC' } } },
    wl_2: { inviteToken: 'wl_2', status: 'waitlist', email: 'w2@x.com', profile: { firstName: 'V', customFields: { fld_role: 'Student' } } },
    inv_p: { inviteToken: 'inv_p', status: 'pending', email: 'p@x.com' },
  };
  // Everyone is read with two scans; per-person lookups would be one read
  // each and too slow for 1000 people.
  db.listAllUsers = async () => Object.values(users);
  db.listInvites = async () => Object.values(invites);
  const perPerson = () => { throw new Error('bulk update must not read people one at a time'); };
  db.getInvite = perPerson; db.getWaitlistEntryByEmail = perPerson; db.getUserByEmail = perPerson;
  db.updateWaitlistEntry = async (t, { email, profile }) => {
    if (invites[t]?.status !== 'waitlist') throw Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' });
    invites[t] = { ...invites[t], email, profile };
  };
});

describe('bulk user update', () => {
  it('sets a group for everyone selected, skipping those already in it', async () => {
    const res = await bulk({ userIds: ['usr_a', 'usr_b'], set: { field: 'userGroup', value: 'Cohort A' } });
    assert.deepEqual(await res.json(), { updated: 1, unchanged: 1, failed: [] });
    assert.deepEqual(updates, [['usr_b', { userGroup: 'Cohort A' }]]);
    assert.equal(audits[0].action, 'users_bulk_updated');
    assert.deepEqual(audits[0].details, { field: 'userGroup', label: 'Group', cleared: false, count: 1, waitlist: 0, failed: 0 });
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

  it('updates wait-list entries’ answers too, keeping the rest of their answers', async () => {
    const res = await bulk({ userIds: ['usr_a'], waitlistTokens: ['wl_1', 'wl_2'], set: { field: 'fld_role', value: 'Teacher' } });
    assert.deepEqual(await res.json(), { updated: 3, unchanged: 0, failed: [] });
    assert.deepEqual(invites.wl_1.profile, { firstName: 'W', userGroup: null, customFields: { fld_org: 'UIC', fld_role: 'Teacher' } });
    assert.deepEqual(invites.wl_2.profile.customFields, { fld_role: 'Teacher' });
    assert.equal(invites.wl_1.email, 'w1@x.com');
    assert.equal(audits[0].details.waitlist, 2);
    // Groups, and only the wait list.
    const g = await bulk({ waitlistTokens: ['wl_1', 'wl_2'], set: { field: 'userGroup', value: 'Cohort B' } });
    assert.equal((await g.json()).updated, 2);
    assert.equal(invites.wl_2.profile.userGroup, 'Cohort B');
    assert.equal(invites.wl_2.profile.firstName, 'V');
  });

  it('skips entries that already have it, and reports ones invited or removed', async () => {
    const res = await bulk({ waitlistTokens: ['wl_1', 'inv_p', 'wl_gone'], set: { field: 'fld_org', value: 'UIC' } });
    assert.deepEqual(await res.json(), {
      updated: 0, unchanged: 1,
      failed: [{ waitlistToken: 'inv_p', error: 'Wait-list entry not found' }, { waitlistToken: 'wl_gone', error: 'Wait-list entry not found' }],
    });
    // Invited between the read and the write.
    db.updateWaitlistEntry = async () => { throw Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }); };
    const raced = await bulk({ waitlistTokens: ['wl_2'], set: { field: 'fld_org', value: 'MIT' } });
    assert.deepEqual((await raced.json()).failed, [{ waitlistToken: 'wl_2', error: 'Wait-list entry not found' }]);
  });

  it('someone who is both a user and on the wait list gets it on both, counted once', async () => {
    users.usr_a.email = 'w1@x.com'; // usr_a also joined the wait list as wl_1
    for (const [body, value] of [[{ userIds: ['usr_a'] }, 'Teacher'], [{ waitlistTokens: ['wl_1'] }, 'Student'], [{ userIds: ['usr_a'], waitlistTokens: ['wl_1'] }, 'Teacher']]) {
      const res = await bulk({ ...body, set: { field: 'fld_role', value } });
      assert.deepEqual(await res.json(), { updated: 1, unchanged: 0, failed: [] }, JSON.stringify(body));
      assert.equal(users.usr_a.customFields.fld_role, value);
      assert.equal(invites.wl_1.profile.customFields.fld_role, value);
    }
    // Already set on both: unchanged, once.
    const same = await bulk({ userIds: ['usr_a'], waitlistTokens: ['wl_1'], set: { field: 'fld_org', value: 'UIC' } });
    assert.deepEqual(await same.json(), { updated: 0, unchanged: 1, failed: [] });
  });

  it('a person whose account changed counts as updated even if their entry couldn’t be', async () => {
    users.usr_a.email = 'w1@x.com';
    db.updateWaitlistEntry = async () => { throw Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }); };
    const res = await bulk({ userIds: ['usr_a'], set: { field: 'fld_role', value: 'Teacher' } });
    assert.deepEqual(await res.json(), { updated: 1, unchanged: 0, failed: [{ waitlistToken: 'wl_1', error: 'Wait-list entry not found' }] });
    assert.equal(users.usr_a.customFields.fld_role, 'Teacher');
  });

  it('1000 people: two reads, writes 10 at a time', async () => {
    users = {};
    for (let i = 0; i < 1000; i++) users[`usr_${i}`] = { userId: `usr_${i}`, email: `u${i}@x.com`, role: 'learner', customFields: {} };
    users.usr_admin = { userId: 'usr_admin', role: 'admin' };
    let inFlight = 0; let peak = 0; let reads = 0;
    const scan = db.listAllUsers;
    db.listAllUsers = async () => { reads++; return scan(); };
    db.updateUser = async (id, u) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      users[id] = { ...users[id], ...u }; inFlight--;
    };
    const res = await bulk({ userIds: Array.from({ length: 1000 }, (_, i) => `usr_${i}`), set: { field: 'userGroup', value: 'Cohort B' } });
    assert.deepEqual(await res.json(), { updated: 1000, unchanged: 0, failed: [] });
    assert.equal(reads, 1);
    assert.equal(peak, 10);
  });

  it('counts users and entries together against the limit', async () => {
    const many = Array.from({ length: 600 }, (_, i) => `x${i}`);
    const res = await bulk({ userIds: many, waitlistTokens: many.map((x) => `w${x}`), set: { field: 'userGroup', value: null } });
    assert.equal(res.status, 400);
  });

  it('is admin-only (educators can’t edit users)', async () => {
    assert.equal((await bulk({ userIds: ['usr_a'], set: { field: 'userGroup', value: 'Cohort B' } }, 'educator')).status, 403);
    assert.deepEqual(updates, []);
  });
});
