/**
 * Admin → Users → User Groups counts (src/lib/groupCounts.js): signed-up
 * people and wait-list entries, with invited people shown apart.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countGroupMembers, describeGroupCount, describeGroupMembers } from '../src/lib/groupCounts.js';

const items = [
  { _type: 'user', userGroup: 'A' },
  { _type: 'user', userGroup: 'A' },
  { _type: 'user', userGroup: null },
  { _type: 'waitlist', userGroup: 'A' },
  { _type: 'invite', userGroup: 'A', _invite: {} },
  { _type: 'invite', userGroup: 'B', _invite: {} },
  { _type: 'invite', userGroup: null, _invite: {} }, // plain invite
  { _type: 'invite', userGroup: 'A', _invite: { existingAccount: true } }, // already counted by their account
];

describe('group counts', () => {
  it('counts users and wait-list entries as people, wait-list invites as invited', () => {
    assert.deepEqual(countGroupMembers(items), {
      A: { people: 3, invited: 1 },
      B: { people: 0, invited: 1 },
    });
  });

  it('an invite for an existing account is not counted twice', () => {
    assert.deepEqual(countGroupMembers([
      { _type: 'user', userGroup: 'A' },
      { _type: 'invite', userGroup: 'A', _invite: { existingAccount: true } },
    ]), { A: { people: 1, invited: 0 } });
  });

  it('shows invited apart only when there are some', () => {
    assert.equal(describeGroupCount({ people: 40, invited: 0 }), '40 people');
    assert.equal(describeGroupCount({ people: 1, invited: 0 }), '1 person');
    assert.equal(describeGroupCount({ people: 40, invited: 560 }), '40 people · 560 invited');
    assert.equal(describeGroupCount(undefined), '0 people');
  });

  it('the delete warning names both', () => {
    assert.equal(describeGroupMembers({ people: 40, invited: 560 }), '40 people and 560 invited people');
    assert.equal(describeGroupMembers({ people: 0, invited: 1 }), '0 people and 1 invited person');
    assert.equal(describeGroupMembers({ people: 2, invited: 0 }), '2 people');
  });
});
