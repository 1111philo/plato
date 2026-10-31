/**
 * User groups (#434, src/lib/groups.js) on real SQLite: sorting, duplicate
 * names, and renames that carry every membership along.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

const DB_PATH = './data/test-groups.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db-sqlite.js');
const { sortGroups, addGroup, renameGroup, deleteGroup, validateGroupName } = await import('../../src/lib/groups.js');

before(async () => {
  await db.createUser({ userId: 'usr_a', email: 'a@x.com', passwordHash: 'x', name: 'A', role: 'learner', userGroup: 'Cohort A' });
  await db.createUser({ userId: 'usr_b', email: 'b@x.com', passwordHash: 'x', name: 'B', role: 'learner', userGroup: 'Cohort B' });
});
after(() => { for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f); });
beforeEach(async () => {
  for (const i of await db.getAllSyncData('_system')) await db.deleteSyncData('_system', i.dataKey);
  for (const i of await db.listInvites()) await db.deleteInvite(i.inviteToken);
  await db.putSyncData('_system', 'settings', { classroomName: 'X', userGroups: ['Cohort B', 'Cohort A'] }, 0);
  await db.updateUser('usr_a', { userGroup: 'Cohort A' });
  await db.updateUser('usr_b', { userGroup: 'Cohort B' });
});
const groups = async () => (await db.getSyncData('_system', 'settings')).data.userGroups;

describe('user groups', () => {
  it('sort A–Z, with None and Other last', () => {
    assert.deepEqual(sortGroups(['other', 'Zeta', 'None', 'alpha', 'Cohort 10', 'Cohort 2']), ['alpha', 'Cohort 2', 'Cohort 10', 'Zeta', 'None', 'other']);
  });

  it('add refuses duplicates ignoring case, and keeps the list sorted', async () => {
    assert.equal((await addGroup('cohort a', { db })).status, 409);
    assert.equal((await addGroup('   ', { db })).status, 400);
    assert.match(validateGroupName('x'.repeat(81), []), /at most 80/);
    assert.deepEqual((await addGroup(' Alumni ', { db })).userGroups, ['Alumni', 'Cohort A', 'Cohort B']);
  });

  it('rename carries users, wait-list entries, invites, and sent messages along', async () => {
    await db.createWaitlistEntry({ inviteToken: 'inv_wl_1', email: 'w@x.com', profile: { firstName: 'W', userGroup: 'Cohort A' } });
    await db.createInvite({ inviteToken: 'inv_p1', email: 'p@x.com', invitedBy: 'usr_admin', profile: { userGroup: 'Cohort A' } });
    await db.createSyncData('_system', 'message:msg_1', { subject: 's', audience: { type: 'group', group: 'Cohort A' } });
    await db.createSyncData('_system', 'message:msg_2', { subject: 's', audience: { type: 'all' } });

    const r = await renameGroup('Cohort A', 'Spring Cohort', { db });
    assert.deepEqual(r.userGroups, ['Cohort B', 'Spring Cohort']);
    assert.deepEqual(r.moved, { users: 1, invites: 2, messages: 1, failed: 0 });
    assert.equal((await db.getUserById('usr_a')).userGroup, 'Spring Cohort');
    assert.equal((await db.getUserById('usr_b')).userGroup, 'Cohort B');
    assert.equal((await db.getInvite('inv_wl_1')).profile.userGroup, 'Spring Cohort');
    assert.equal((await db.getInvite('inv_p1')).profile.userGroup, 'Spring Cohort');
    assert.equal((await db.getSyncData('_system', 'message:msg_1')).data.audience.group, 'Spring Cohort');
  });

  it('rename can change case only, but not onto another group; unknown groups are 404', async () => {
    assert.deepEqual((await renameGroup('Cohort A', 'cohort a', { db })).userGroups, ['cohort a', 'Cohort B']);
    assert.equal((await db.getUserById('usr_a')).userGroup, 'cohort a');
    const clash = await renameGroup('cohort a', 'COHORT B', { db });
    assert.equal(clash.status, 409);
    assert.equal((await db.getUserById('usr_a')).userGroup, 'cohort a', 'nothing moved');
    assert.equal((await renameGroup('Nope', 'X', { db })).status, 404);
  });

  it('delete clears the group from members and invites', async () => {
    await db.createWaitlistEntry({ inviteToken: 'inv_wl_2', email: 'v@x.com', profile: { userGroup: 'Cohort B' } });
    const r = await deleteGroup('Cohort B', { db });
    assert.deepEqual(r.userGroups, ['Cohort A']);
    assert.equal((await db.getUserById('usr_b')).userGroup, null);
    assert.equal((await db.getInvite('inv_wl_2')).profile.userGroup, null);
    assert.equal((await deleteGroup('Cohort B', { db })).status, 404);
    assert.deepEqual(await groups(), ['Cohort A']);
  });
});
