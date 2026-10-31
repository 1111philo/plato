/**
 * Invites for people who already have an account (#363): what accepting
 * merges, and the classroom routes that show, accept, and decline them.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import me from '../../src/routes/me.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { mergeProfile } from '../../src/lib/account-invites.js';

const FIELDS = [
  { id: 'fld_org', label: 'Organization', type: 'text', required: true },
  { id: 'fld_role', label: 'Role', type: 'dropdown', required: false, options: ['Staff', 'Student'] },
  { id: 'fld_x', label: 'X', type: 'text', required: false },
];
const SETTINGS = { userGroups: ['Cohort A'], userFields: FIELDS };
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

describe('mergeProfile', () => {
  it('fills only what the account is missing, never the name', () => {
    const user = { userId: 'usr_ada', name: 'Ada L', userGroup: null, customFields: { fld_x: 'kept' } };
    const profile = { name: 'Someone Else', userGroup: 'Cohort A', customFields: { fld_org: 'UIC', fld_role: 'Staff', fld_x: 'new' } };
    const r = mergeProfile(user, profile, SETTINGS);
    assert.deepEqual(r.updates, { userGroup: 'Cohort A', customFields: { fld_x: 'kept', fld_org: 'UIC', fld_role: 'Staff' } });
    assert.deepEqual(r.fields, ['fld_org', 'fld_role']);
  });

  it('keeps an account group; skips a deleted group and invalid answers', () => {
    assert.deepEqual(mergeProfile({ userGroup: 'Cohort B' }, { userGroup: 'Cohort A' }, SETTINGS).updates, {});
    assert.deepEqual(mergeProfile({}, { userGroup: 'Gone', customFields: { fld_role: 'Not an option' } }, SETTINGS).updates, {});
    assert.deepEqual(mergeProfile({}, null, SETTINGS).updates, {});
  });
});

describe('/v1/me/invite', () => {
  let user, invite, updates, used, deleted, audits;
  const app = () => { const a = new Hono(); a.route('/', me); return a; };
  async function req(method, path) {
    const token = await signAccessToken('usr_ada', 'learner');
    return app().request(path, { method, headers: { Authorization: 'Bearer ' + token } });
  }

  beforeEach(() => {
    user = { userId: 'usr_ada', email: 'ada@example.com', role: 'learner', firstName: 'Ada', userGroup: null, customFields: {} };
    invite = {
      inviteToken: 'inv_acct', email: 'ada@example.com', status: 'pending', ttl: FUTURE, invitedBy: 'usr_admin',
      forUserId: 'usr_ada', createdAt: '2026-10-31', profile: { userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } },
    };
    updates = []; used = []; deleted = []; audits = [];
    db.getUserById = async (id) => (id === 'usr_ada' ? user : { userId: id, firstName: 'Blake', lastName: 'B' });
    db.getSyncData = async (_u, key) => (key === 'settings' ? { data: SETTINGS } : null);
    db.getInviteByEmail = async () => invite;
    db.getInvite = async (t) => (t === invite.inviteToken ? invite : null);
    db.updateUser = async (id, u) => { updates.push([id, u]); };
    db.markInviteUsed = async (t) => { used.push(t); };
    db.deleteInvite = async (t) => { deleted.push(t); };
    db.createAuditLog = async (a) => { audits.push(a); };
  });

  it('shows the invite and what accepting would add', async () => {
    const { invite: shown } = await (await req('GET', '/v1/me/invite')).json();
    assert.deepEqual(shown, { inviteToken: 'inv_acct', invitedByName: 'Blake B', userGroup: 'Cohort A', fields: ['Organization'], createdAt: '2026-10-31' });
  });

  it('shows nothing for an ordinary invite, someone else’s, or an expired one', async () => {
    for (const inv of [{ ...invite, forUserId: undefined }, { ...invite, forUserId: 'usr_other' }, { ...invite, ttl: 1 }, null]) {
      invite = inv;
      assert.deepEqual(await (await req('GET', '/v1/me/invite')).json(), { invite: null });
    }
  });

  it('accept merges the answers, uses up the invite, and is audited', async () => {
    const res = await req('POST', '/v1/me/invite/inv_acct/accept');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userGroup: 'Cohort A', fields: ['fld_org'] });
    assert.deepEqual(updates, [['usr_ada', { userGroup: 'Cohort A', customFields: { fld_org: 'UIC' } }]]);
    assert.deepEqual(used, ['inv_acct']);
    assert.equal(audits[0].action, 'account_invite_accepted');
  });

  it('decline discards it and leaves the account alone', async () => {
    assert.equal((await req('POST', '/v1/me/invite/inv_acct/decline')).status, 200);
    assert.deepEqual(deleted, ['inv_acct']);
    assert.deepEqual(updates, []);
    assert.equal(audits[0].action, 'account_invite_declined');
  });

  it('nobody can accept or decline someone else’s invite', async () => {
    invite = { ...invite, forUserId: 'usr_other' };
    assert.equal((await req('POST', '/v1/me/invite/inv_acct/accept')).status, 404);
    assert.equal((await req('POST', '/v1/me/invite/inv_acct/decline')).status, 404);
    assert.equal((await req('POST', '/v1/me/invite/inv_nope/accept')).status, 404);
    assert.deepEqual([updates, used, deleted], [[], [], []]);
  });
});
