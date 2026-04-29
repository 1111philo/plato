import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { pluginRegistry } from '../../src/lib/plugins/registry.js';

const origLog = console.log;
const origWarn = console.warn;
const origErr = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

async function adminReq(app, method, path, body) {
  const token = await signAccessToken('usr_admin', 'admin');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function userReq(app, method, path, body) {
  const token = await signAccessToken('usr_user', 'user');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /v1/admin/plugins/:id/uninstall-data', () => {
  let realUninstall;
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin', email: 'admin@example.com' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
    db.createAuditLog = async () => {};
    realUninstall = pluginRegistry.uninstallData;
  });
  afterEach(() => { pluginRegistry.uninstallData = realUninstall; });

  it('rejects non-admin', async () => {
    pluginRegistry.uninstallData = async () => { throw new Error('should not be called'); };
    const app = new Hono();
    app.route('/', admin);
    const res = await userReq(app, 'POST', '/v1/admin/plugins/demo/uninstall-data', { confirm: 'demo' });
    assert.equal(res.status, 403);
  });

  it('rejects request with missing or wrong confirm', async () => {
    pluginRegistry.uninstallData = async () => { throw new Error('should not be called'); };
    const app = new Hono();
    app.route('/', admin);
    assert.equal((await adminReq(app, 'POST', '/v1/admin/plugins/demo/uninstall-data', {})).status, 400);
    assert.equal((await adminReq(app, 'POST', '/v1/admin/plugins/demo/uninstall-data', { confirm: 'wrong-id' })).status, 400);
  });

  it('rejects when registry refuses (plugin still enabled)', async () => {
    pluginRegistry.uninstallData = async () => { throw new Error('plugin "demo" must be disabled before uninstalling data'); };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/plugins/demo/uninstall-data', { confirm: 'demo' });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /must be disabled/);
  });

  it('runs the registry uninstall and writes an audit log on success', async () => {
    let registryCalled = null;
    let auditCalled = null;
    pluginRegistry.uninstallData = async (id) => { registryCalled = id; };
    db.createAuditLog = async (entry) => { auditCalled = entry; };

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/plugins/demo/uninstall-data', { confirm: 'demo' });
    assert.equal(res.status, 200);
    assert.equal(registryCalled, 'demo');
    assert.equal(auditCalled?.action, 'plugin_data_uninstalled');
    assert.equal(auditCalled?.performedBy, 'usr_admin');
    assert.deepEqual(auditCalled?.details, { pluginId: 'demo' });
  });
});

describe('teacher-comments onUninstall (worked example)', () => {
  it('iterates users and deletes their userMeta records', async () => {
    // Build a tiny in-memory db to verify the plugin's teardown wipes records.
    const meta = new Map();
    db.listAllUsers = async () => [
      { userId: 'usr_x' }, { userId: 'usr_y' }, { userId: 'usr_z' },
    ];
    db.getSyncData = async (u, key) => meta.get(`${u}\0${key}`) || null;
    db.putSyncData = async (u, key, data, _ver) => {
      meta.set(`${u}\0${key}`, { data, version: 1 });
      return { version: 1 };
    };
    db.deleteSyncData = async (u, key) => { meta.delete(`${u}\0${key}`); };

    // Seed two users with comments. Third user has none.
    meta.set('usr_x\0userMeta:teacher-comments', { data: { comments: [{ id: 'a', text: 'x' }] }, version: 1 });
    meta.set('usr_y\0userMeta:teacher-comments', { data: { comments: [{ id: 'b', text: 'y' }] }, version: 1 });

    const plugin = (await import('../../../plugins/teacher-comments/server/index.js')).default;
    const ctx = { pluginId: 'teacher-comments', logger: { info: () => {}, warn: () => {}, error: () => {} } };
    await plugin.onUninstall(ctx);

    assert.equal(meta.size, 0, 'all comment records cleaned up');
  });
});

process.on('exit', () => { console.log = origLog; console.warn = origWarn; console.error = origErr; });
