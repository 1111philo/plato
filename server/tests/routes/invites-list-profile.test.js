/**
 * GET /v1/admin/invites: an invite made from a wait-list entry keeps the
 * entry's name, group, and answers (`profile`) until signup copies them onto
 * the account. The list returns them, so the Users page doesn't show those
 * people as blank while their invite is pending.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

const ROLES = { usr_admin: 'admin', usr_test: 'tester' };
async function list(as = 'usr_admin') {
  const app = new Hono();
  app.route('/', admin);
  const token = await signAccessToken(as, ROLES[as]);
  const res = await app.request('/v1/admin/invites', { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

const FIELDS = [
  { id: 'fld_org', label: 'Org', type: 'text' },
  { id: 'fld_note', label: 'Admin note', type: 'text', hideFromApi: true },
];

let invites;
beforeEach(() => {
  invites = [
    {
      inviteToken: 'inv_wl', status: 'pending', email: 'ann@x.com', createdAt: '2026-11-10T00:00:00Z',
      profile: { firstName: 'Ann', lastName: 'Lee', name: 'Ann Lee', userGroup: 'Cohort 2', customFields: { fld_org: 'UIC', fld_note: 'VIP', fld_gone: 'old' } },
    },
    { inviteToken: 'inv_plain', status: 'pending', email: 'bo@x.com', createdAt: '2026-11-10T00:00:00Z' },
    { inviteToken: 'inv_legacy', status: 'pending', email: 'cy@x.com', createdAt: '2026-11-10T00:00:00Z', profile: { name: 'Cy Ray', userGroup: null } },
    { inviteToken: 'inv_link', status: 'pending', isLink: true, email: null, createdAt: '2026-11-10T00:00:00Z' },
  ];
  db.getUserById = async (id) => (ROLES[id] ? { userId: id, role: ROLES[id], name: id } : null);
  db.listInvites = async () => invites;
  db.getSyncData = async (owner, key) => (owner === '_system' && key === 'settings' ? { data: { userGroups: ['Cohort 2'], userFields: FIELDS } } : null);
});

describe('GET /v1/admin/invites keeps wait-list details', () => {
  it('returns the name, group, and answers an invite carried over from the wait list', async () => {
    const { status, body } = await list();
    assert.equal(status, 200);
    const ann = body.find((i) => i.inviteToken === 'inv_wl');
    assert.equal(ann.firstName, 'Ann');
    assert.equal(ann.lastName, 'Lee');
    assert.equal(ann.name, 'Ann Lee');
    assert.equal(ann.userGroup, 'Cohort 2');
    // Admins see every defined field (hidden-from-API ones too, like the wait
    // list); answers to deleted fields are left out.
    assert.deepEqual(ann.customFields, { fld_org: 'UIC', fld_note: 'VIP' });
  });

  it('a plain invite or a link invite gets no profile fields', async () => {
    const { body } = await list();
    for (const token of ['inv_plain', 'inv_link']) {
      const inv = body.find((i) => i.inviteToken === token);
      assert.equal(inv.name, undefined);
      assert.equal(inv.userGroup, undefined);
      assert.equal(inv.customFields, undefined);
    }
  });

  it('splits a legacy single `name` (#402)', async () => {
    const { body } = await list();
    const cy = body.find((i) => i.inviteToken === 'inv_legacy');
    assert.equal(cy.firstName, 'Cy');
    assert.equal(cy.lastName, 'Ray');
    assert.equal(cy.userGroup, null);
    assert.deepEqual(cy.customFields, {});
  });

  it('testers (invites.read) see the same list', async () => {
    const { status, body } = await list('usr_test');
    assert.equal(status, 200);
    assert.equal(body.find((i) => i.inviteToken === 'inv_wl').userGroup, 'Cohort 2');
  });
});
