import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import me from '../../src/routes/me.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

async function authedReq(app, method, path, body, role = 'user') {
  const token = await signAccessToken('usr_test', role);
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Routes read custom user field definitions from `_system:settings` (#364).
// Default to "no settings" so tests that don't care never fall through to the
// real DynamoDB client; tests that need fields override this.
beforeEach(() => {
  db.getSyncData = async () => null;
});

describe('GET /v1/me', () => {
  beforeEach(() => {
    db.getUserById = async () => ({
      userId: 'usr_test', email: 'test@example.com', name: 'Test',
      userGroup: 'Org', role: 'user',
      createdAt: '2024-01-01T00:00:00Z',
    });
  });

  it('returns user profile', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'GET', '/v1/me');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Test');
    assert.equal(data.email, 'test@example.com');
    assert.equal(data.passwordHash, undefined);
  });

  it('rejects unauthenticated request', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await app.request('/v1/me');
    assert.equal(res.status, 401);
  });
});

describe('PATCH /v1/me', () => {
  beforeEach(() => {
    db.getUserById = async () => ({
      userId: 'usr_test', email: 'test@example.com', username: 'testuser', name: 'Updated',
      userGroup: null, role: 'user',
    });
    db.getUserByEmail = async () => null;
    db.getUserByUsername = async () => null;
    db.updateUser = async () => {};
  });

  it('updates name', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'PATCH', '/v1/me', { name: 'Updated' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Updated');
  });

  it('updates username', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'PATCH', '/v1/me', { username: 'newname' });
    assert.equal(res.status, 200);
  });

  it('rejects invalid username', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'PATCH', '/v1/me', { username: '-bad' });
    assert.equal(res.status, 400);
  });

  it('rejects taken username', async () => {
    db.getUserByUsername = async () => ({ userId: 'usr_other' });
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'PATCH', '/v1/me', { username: 'taken' });
    assert.equal(res.status, 409);
  });

  it('rejects short password', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'PATCH', '/v1/me', { password: 'short' });
    assert.equal(res.status, 400);
  });
});

describe('GET /v1/me/export', () => {
  beforeEach(() => {
    db.getUserById = async () => ({
      userId: 'usr_test', email: 'test@example.com', name: 'Test',
      userGroup: 'Org', role: 'user',
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-06-01T00:00:00Z',
    });
    db.getAllSyncData = async () => [
      { dataKey: 'profile', data: { bio: 'hi' }, version: 1, updatedAt: '2024-06-01T00:00:00Z' },
      { dataKey: 'work', data: [{ id: 'w1' }], version: 2, updatedAt: '2024-06-01T00:00:00Z' },
    ];
  });

  it('exports user profile and sync data', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'GET', '/v1/me/export');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.profile.email, 'test@example.com');
    assert.ok(data.syncData.profile);
    assert.ok(data.syncData.work);
    assert.ok(data.exportedAt);
  });

  it('excludes plugin-owned userMeta:* records (admin-only data not learner-exportable)', async () => {
    db.getAllSyncData = async () => [
      { dataKey: 'profile', data: { bio: 'hi' }, version: 1, updatedAt: '2024-06-01T00:00:00Z' },
      { dataKey: 'userMeta:teacher-comments', data: { comments: [{ text: 'private admin note' }] }, version: 1, updatedAt: '2024-06-01T00:00:00Z' },
      { dataKey: 'userMeta:other-plugin', data: { secret: 'xyz' }, version: 1, updatedAt: '2024-06-01T00:00:00Z' },
      { dataKey: 'work', data: [{ id: 'w1' }], version: 2, updatedAt: '2024-06-01T00:00:00Z' },
    ];
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'GET', '/v1/me/export');
    const data = await res.json();
    const keys = Object.keys(data.syncData).sort();
    assert.deepEqual(keys, ['profile', 'work'], 'userMeta:* leaked to learner via export');
    // Defense-in-depth: also assert the secret string is nowhere in the body.
    const body = JSON.stringify(data);
    assert.equal(body.includes('private admin note'), false);
    assert.equal(body.includes('userMeta:'), false);
  });
});

describe('DELETE /v1/me', () => {
  let deletedUser, deletedSync, auditCreated;

  beforeEach(() => {
    deletedUser = false;
    deletedSync = [];
    auditCreated = null;
    db.getUserById = async () => ({
      userId: 'usr_test', email: 'test@example.com', name: 'Test',
      userGroup: 'Org', role: 'user',
    });
    db.getAllSyncData = async () => [
      { dataKey: 'profile' },
      { dataKey: 'work' },
    ];
    db.deleteSyncData = async (_uid, key) => { deletedSync.push(key); };
    db.deleteUser = async () => { deletedUser = true; };
    db.createAuditLog = async (entry) => { auditCreated = entry; };
  });

  it('deletes account when confirmed', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'DELETE', '/v1/me', { confirm: 'DELETE' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(deletedUser);
    assert.deepEqual(deletedSync, ['profile', 'work']);
    assert.equal(auditCreated.action, 'user_deleted');
    assert.equal(auditCreated.details.selfDelete, true);
  });

  it('rejects without confirmation', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'DELETE', '/v1/me', { confirm: 'nope' });
    assert.equal(res.status, 400);
    assert.ok(!deletedUser);
  });

  it('rejects missing confirm field', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await authedReq(app, 'DELETE', '/v1/me', {});
    assert.equal(res.status, 400);
  });
});


describe('custom user fields (#364)', () => {
  const FIELDS = [
    { id: 'fld_org', label: 'Organization', type: 'text', required: true },
    { id: 'fld_role', label: 'Role', type: 'dropdown', required: false, options: ['Teacher', 'Student'] },
  ];
  let stored;
  let lastUpdate;

  beforeEach(() => {
    stored = { fld_role: 'Teacher', fld_deleted: 'stale' };
    lastUpdate = null;
    db.getUserById = async () => ({
      userId: 'usr_test', email: 'test@example.com', username: 'testuser', name: 'Test',
      userGroup: null, role: 'user', customFields: stored,
    });
    db.getSyncData = async (userId, key) =>
      userId === '_system' && key === 'settings' ? { data: { userFields: FIELDS }, version: 1 } : null;
    db.updateUser = async (_id, updates) => {
      lastUpdate = updates;
      if (updates.customFields) stored = updates.customFields;
    };
  });

  function makeApp() {
    const app = new Hono();
    app.route('/', me);
    return app;
  }

  it('GET /v1/me/fields returns definitions, visible values, and missing required ids', async () => {
    const res = await authedReq(makeApp(), 'GET', '/v1/me/fields');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.userFields, FIELDS);
    assert.deepEqual(data.values, { fld_role: 'Teacher' }); // deleted-field value hidden
    assert.deepEqual(data.missing, ['fld_org']);
  });

  it('GET /v1/me includes customFields', async () => {
    const data = await (await authedReq(makeApp(), 'GET', '/v1/me')).json();
    assert.deepEqual(data.customFields, { fld_role: 'Teacher' });
  });

  it('PATCH /v1/me merges customFields and returns them', async () => {
    const res = await authedReq(makeApp(), 'PATCH', '/v1/me', { customFields: { fld_org: ' UIC ' } });
    assert.equal(res.status, 200);
    assert.deepEqual(lastUpdate.customFields, { fld_role: 'Teacher', fld_org: 'UIC' });
    const data = await res.json();
    assert.deepEqual(data.customFields, { fld_role: 'Teacher', fld_org: 'UIC' });
  });

  it('PATCH /v1/me rejects clearing a required field', async () => {
    stored = { fld_org: 'UIC' };
    const res = await authedReq(makeApp(), 'PATCH', '/v1/me', { customFields: { fld_org: '' } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Organization is required/);
    assert.equal(lastUpdate, null);
  });

  it('PATCH /v1/me rejects an invalid dropdown value', async () => {
    const res = await authedReq(makeApp(), 'PATCH', '/v1/me', { customFields: { fld_role: 'Janitor' } });
    assert.equal(res.status, 400);
  });

  it('GET /v1/me/export includes labelled custom field values', async () => {
    db.getAllSyncData = async () => [];
    const data = await (await authedReq(makeApp(), 'GET', '/v1/me/export')).json();
    assert.deepEqual(data.profile.customFields, [{ id: 'fld_role', label: 'Role', value: 'Teacher' }]);
  });
});
