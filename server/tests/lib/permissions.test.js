/**
 * Roles & permissions (#435): the matrix, normalizeRole, the route table,
 * and the safety net that every registered admin route is mapped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import admin from '../../src/routes/admin.js';
import { can, normalizeRole, permissionFor, ROUTE_PERMISSIONS, ADMIN_ONLY, ROLE_PERMISSIONS } from '../../src/lib/permissions.js';

describe('normalizeRole', () => {
  it('maps legacy "user" and unknown values to learner', () => {
    assert.equal(normalizeRole('user'), 'learner');
    assert.equal(normalizeRole(undefined), 'learner');
    assert.equal(normalizeRole('superuser'), 'learner');
    for (const r of ['admin', 'educator', 'learner', 'tester']) assert.equal(normalizeRole(r), r);
  });
});

describe('can()', () => {
  it('admin can do everything, including unmapped admin-only routes', () => {
    assert.ok(can('admin', 'users.role'));
    assert.ok(can('admin', ADMIN_ONLY));
  });

  it('learners (and legacy "user") have no admin permissions', () => {
    for (const r of ['learner', 'user']) {
      assert.equal(can(r, 'admin.access'), false);
      assert.equal(can(r, 'content.read'), false);
    }
  });

  it('educators manage content and invites, view users, and nothing else', () => {
    for (const p of ['content.read', 'content.write', 'users.read', 'stats.read', 'invites.write', 'waitlist.invite']) assert.ok(can('educator', p), p);
    for (const p of ['users.write', 'users.role', 'theme.write', 'kb.write', 'plugins.write', 'prompts.write', 'settings.write', 'fields.write', 'groups.write', 'waitlist.write', 'logs.read', 'impersonation.use', ADMIN_ONLY]) {
      assert.equal(can('educator', p), false, p);
    }
  });

  it('testers read everything and write nothing', () => {
    for (const p of ['content.read', 'users.read', 'logs.read', 'plugins.read', 'prompts.read', 'kb.read']) assert.ok(can('tester', p), p);
    for (const p of ['content.write', 'users.write', 'users.role', 'invites.write', 'theme.write', 'plugins.write', ADMIN_ONLY]) assert.equal(can('tester', p), false, p);
    assert.ok(can('tester', 'impersonation.use'), 'View as User is a read-only audit');
  });
});

describe('route table', () => {
  it('every route registered on the admin app is mapped (new routes cannot slip in unclassified)', () => {
    const registered = admin.routes
      .filter((r) => r.path.startsWith('/v1/admin/') && r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path}`);
    assert.ok(registered.length >= 50, `found ${registered.length} admin routes`);
    const unmapped = registered.filter((k) => !(k in ROUTE_PERMISSIONS));
    assert.deepEqual(unmapped, [], 'add these to ROUTE_PERMISSIONS in src/lib/permissions.js');
  });

  it('every table entry is a real route (no stale rows)', () => {
    const registered = new Set(admin.routes.map((r) => `${r.method} ${r.path}`));
    const stale = Object.keys(ROUTE_PERMISSIONS).filter((k) => !registered.has(k));
    assert.deepEqual(stale, []);
  });

  it('resolves concrete paths, preferring literal segments over params', () => {
    assert.equal(permissionFor('GET', '/v1/admin/users/usr_123'), 'users.read');
    assert.equal(permissionFor('PUT', '/v1/admin/users/usr_123/role'), 'users.role');
    assert.equal(permissionFor('POST', '/v1/admin/waitlist/key'), 'waitlist.write');
    assert.equal(permissionFor('POST', '/v1/admin/waitlist/inv_wl_x/invite'), 'waitlist.invite');
    assert.equal(permissionFor('PUT', '/v1/admin/user-fields/order'), 'fields.write');
    assert.equal(permissionFor('PUT', '/v1/admin/user-fields/fld_1'), 'fields.write');
    assert.equal(permissionFor('HEAD', '/v1/admin/lessons'), 'content.read');
    assert.equal(permissionFor('GET', '/v1/admin/lessons/'), 'content.read');
  });

  it('unknown admin routes are admin-only', () => {
    assert.equal(permissionFor('POST', '/v1/admin/brand-new-thing'), ADMIN_ONLY);
    assert.equal(permissionFor('DELETE', '/v1/admin/lessons'), ADMIN_ONLY, 'method matters');
  });

  it('every permission used in the table is grantable to admin, and role lists use real permissions', () => {
    const used = new Set(Object.values(ROUTE_PERMISSIONS));
    for (const p of used) assert.ok(can('admin', p));
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of perms) if (p !== '*' && p !== 'admin.access') assert.ok(used.has(p), `${role}: ${p} is not used by any route`);
    }
  });
});
