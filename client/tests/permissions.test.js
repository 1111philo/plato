/**
 * The client's permission map (drives nav and controls) must match the
 * server's (enforces). Compared directly so they can't drift.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/lib/permissions.js';
import * as server from '../../server/src/lib/permissions.js';

describe('client permissions mirror the server', () => {
  it('same roles and permission lists', () => {
    assert.deepEqual(client.ROLES, server.ROLES);
    assert.deepEqual(client.ROLE_PERMISSIONS, server.ROLE_PERMISSIONS);
  });

  it('can() agrees with the server for every role and every routed permission', () => {
    const perms = new Set([...Object.values(server.ROUTE_PERMISSIONS), 'admin.access', server.ADMIN_ONLY]);
    for (const role of [...server.ROLES, 'user', undefined]) {
      for (const p of perms) assert.equal(client.can({ role }, p), server.can(role, p), `${role} ${p}`);
    }
  });

  it('normalizes legacy and missing roles', () => {
    assert.equal(client.normalizeRole('user'), 'learner');
    assert.equal(client.can(null, 'admin.access'), false);
    assert.equal(client.roleLabel('user'), 'Learner');
    assert.ok(client.isTester({ role: 'tester' }));
  });
});
