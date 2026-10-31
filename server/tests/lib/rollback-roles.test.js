/**
 * The roles rollback (scripts/rollback-roles.js): new roles back to `user`,
 * admins untouched, dry run writes nothing, a second run changes nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rollbackRoles } from '../../src/lib/rollback-roles.js';

function fakeDb(users) {
  return {
    users,
    listAllUsers: async () => users.map((u) => ({ ...u })),
    setUserRoleIf: async (id, from, to) => {
      const u = users.find((x) => x.userId === id);
      if (u.role !== from) return false;
      u.role = to;
      return true;
    },
  };
}

describe('rollbackRoles', () => {
  const start = () => [
    { userId: 'usr_a', role: 'admin' }, { userId: 'usr_l', role: 'learner' }, { userId: 'usr_u', role: 'user' },
    { userId: 'usr_e', role: 'educator' }, { userId: 'usr_t', role: 'tester' },
  ];

  it('dry run lists the changes and writes nothing', async () => {
    const db = fakeDb(start());
    const r = await rollbackRoles({ db });
    assert.deepEqual(r.changes.map((c) => [c.userId, c.from]), [['usr_l', 'learner'], ['usr_e', 'educator'], ['usr_t', 'tester']]);
    assert.deepEqual(db.users.map((u) => u.role), ['admin', 'learner', 'user', 'educator', 'tester']);
  });

  it('apply sets them to user, leaves admins, and is idempotent', async () => {
    const db = fakeDb(start());
    const r = await rollbackRoles({ db, apply: true });
    assert.equal(r.failed, 0);
    assert.deepEqual(db.users.map((u) => u.role), ['admin', 'user', 'user', 'user', 'user']);
    assert.deepEqual((await rollbackRoles({ db, apply: true })).changes, []);
  });

  it('counts a role changed meanwhile as failed, not overwritten', async () => {
    const db = fakeDb(start());
    db.setUserRoleIf = async () => false;
    const r = await rollbackRoles({ db, apply: true });
    assert.equal(r.failed, 3);
  });
});
