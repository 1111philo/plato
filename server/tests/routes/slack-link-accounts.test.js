/**
 * Bulk "Slack link" (plugins/slack/server/link-accounts.js): match plato
 * accounts to workspace members by email, never changing an existing link.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planLinks, linkAccounts } from '../../../plugins/slack/server/link-accounts.js';

const MEMBERS = [
  { slackUserId: 'U1', email: 'Ada@X.com' },
  { slackUserId: 'U2', email: 'bo@x.com' },
  { slackUserId: 'U3', email: null },
];

describe('Slack link accounts', () => {
  it('matches by email, ignoring case; keeps existing links; counts people not in Slack', () => {
    const plan = planLinks([
      { userId: 'usr_1', email: 'ada@x.com' },
      { userId: 'usr_2', email: 'bo@x.com', slackUserId: 'U_OLD' },
      { userId: 'usr_3', email: 'cy@x.com' },
      { userId: 'usr_4' },
    ], MEMBERS);
    assert.deepEqual(plan, { toLink: [{ userId: 'usr_1', slackUserId: 'U1' }], alreadyLinked: 1, notInWorkspace: 2 });
  });

  it('links each match and reports failures without stopping', async () => {
    const linked = new Map();
    const users = [{ userId: 'usr_1', email: 'ada@x.com' }, { userId: 'usr_2', email: 'bo@x.com' }];
    const r = await linkAccounts(users, MEMBERS, async (id, sid) => {
      if (id === 'usr_1') throw new Error('db down');
      linked.set(id, sid);
    });
    assert.deepEqual(r, { linked: 1, alreadyLinked: 0, notInWorkspace: 0, failed: 1 });
    assert.equal(linked.get('usr_2'), 'U2');
  });
});
