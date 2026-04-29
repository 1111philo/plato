import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import me from '../../src/routes/me.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { pluginRegistry } from '../../src/lib/plugins/registry.js';

// Silence the host logger's stdout mirror so test output stays clean.
const origErr = console.error;
const origWarn = console.warn;
const origLog = console.log;
console.error = () => {};
console.warn = () => {};
console.log = () => {};

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

// Sample plugin entry fixture.
function makeEntry({ id = 'demo', enabled = true, settings = {}, schema = null } = {}) {
  return {
    manifest: {
      id, name: id, version: '1.0.0', description: `${id} plugin`,
      capabilities: ['settings.read', 'settings.write'],
      extensionPoints: {},
      settingsSchema: schema,
    },
    dir: `/fake/${id}`,
    serverModule: null,
    enabled, settings, loadError: null, hookUnsubs: [],
  };
}

describe('GET /v1/admin/plugins', () => {
  let realList;
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
    realList = pluginRegistry.list;
  });
  afterEach(() => { pluginRegistry.list = realList; });

  it('returns plugin list to admins', async () => {
    pluginRegistry.list = () => [makeEntry({ id: 'demo', enabled: true })];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/plugins');
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'demo');
    assert.equal(list[0].enabled, true);
  });

  it('rejects non-admin', async () => {
    pluginRegistry.list = () => [];
    const app = new Hono();
    app.route('/', admin);
    const res = await userReq(app, 'GET', '/v1/admin/plugins');
    assert.equal(res.status, 403);
  });

  it('strips writeOnly settings from response (e.g. bot tokens)', async () => {
    const schema = {
      type: 'object',
      properties: {
        botToken: { type: 'string', writeOnly: true },
        workspaceName: { type: 'string' },
        connected: { type: 'boolean' },
      },
    };
    pluginRegistry.list = () => [makeEntry({
      id: 'slack',
      settings: { botToken: 'xoxb-SECRET', workspaceName: 'Acme', connected: true },
      schema,
    })];
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/plugins');
    const list = await res.json();
    assert.equal(list[0].settings.botToken, undefined, 'writeOnly botToken must not appear in response');
    assert.equal(list[0].settings.workspaceName, 'Acme', 'non-writeOnly fields preserved');
    assert.equal(list[0].settings.connected, true);
  });
});

describe('PUT /v1/admin/plugins/:id/activation', () => {
  let realList, realSetEnabled;
  beforeEach(() => {
    db.getUserById = async (id) => id === 'usr_admin' ? { userId: 'usr_admin', role: 'admin', name: 'Admin' } : null;
    realList = pluginRegistry.list;
    realSetEnabled = pluginRegistry.setEnabled;
  });
  afterEach(() => {
    pluginRegistry.list = realList;
    pluginRegistry.setEnabled = realSetEnabled;
  });

  it('toggles enabled state', async () => {
    let received = null;
    pluginRegistry.setEnabled = async (id, enabled) => {
      received = { id, enabled };
      return makeEntry({ id, enabled });
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/plugins/demo/activation', { enabled: false });
    assert.equal(res.status, 200);
    assert.deepEqual(received, { id: 'demo', enabled: false });
  });

  it('rejects request without `enabled`', async () => {
    pluginRegistry.setEnabled = async () => { throw new Error('should not be called'); };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/plugins/demo/activation', {});
    assert.equal(res.status, 400);
  });

  it('returns 400 when registry rejects unknown plugin', async () => {
    pluginRegistry.setEnabled = async () => { throw new Error('unknown plugin: ghost'); };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/plugins/ghost/activation', { enabled: true });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /unknown plugin/);
  });
});

describe('PUT /v1/admin/plugins/:id/settings', () => {
  let realUpdateSettings;
  beforeEach(() => {
    db.getUserById = async (id) => id === 'usr_admin' ? { userId: 'usr_admin', role: 'admin', name: 'Admin' } : null;
    realUpdateSettings = pluginRegistry.updateSettings;
  });
  afterEach(() => { pluginRegistry.updateSettings = realUpdateSettings; });

  it('persists settings and returns sanitized response', async () => {
    const schema = {
      type: 'object',
      properties: { botToken: { type: 'string', writeOnly: true }, workspaceName: { type: 'string' } },
    };
    let saved = null;
    pluginRegistry.updateSettings = async (id, settings) => {
      saved = { id, settings };
      return makeEntry({ id, settings, schema });
    };
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'PUT', '/v1/admin/plugins/slack/settings', {
      botToken: 'xoxb-NEW',
      workspaceName: 'NewSpace',
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(saved.settings, { botToken: 'xoxb-NEW', workspaceName: 'NewSpace' });
    // writeOnly stripped from the response too
    assert.equal(data.settings.botToken, undefined);
    assert.equal(data.settings.workspaceName, 'NewSpace');
  });

  it('rejects missing body', async () => {
    pluginRegistry.updateSettings = async () => { throw new Error('should not be called'); };
    const app = new Hono();
    app.route('/', admin);
    const token = await signAccessToken('usr_admin', 'admin');
    const res = await app.request('/v1/admin/plugins/slack/settings', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      // no body
    });
    assert.equal(res.status, 400);
  });

  it('rejects non-object body (string, number, array)', async () => {
    pluginRegistry.updateSettings = async () => { throw new Error('should not be called'); };
    const app = new Hono();
    app.route('/', admin);
    const token = await signAccessToken('usr_admin', 'admin');
    for (const body of ['"a string"', '42', '[1,2,3]', 'null']) {
      const res = await app.request('/v1/admin/plugins/slack/settings', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(res.status, 400, `expected 400 for body ${body}`);
    }
  });
});

describe('GET /v1/plugins (non-admin sanitized list)', () => {
  let realList;
  beforeEach(() => {
    db.getUserById = async (id) => id === 'usr_user' ? { userId: 'usr_user', role: 'user' } : null;
    realList = pluginRegistry.list;
  });
  afterEach(() => { pluginRegistry.list = realList; });

  it('omits load-failed plugins and strips writeOnly fields', async () => {
    pluginRegistry.list = () => [
      makeEntry({
        id: 'slack',
        settings: { botToken: 'xoxb-LEAK', workspaceName: 'WS', connected: true },
        schema: {
          type: 'object',
          properties: { botToken: { type: 'string', writeOnly: true }, workspaceName: { type: 'string' }, connected: { type: 'boolean' } },
        },
      }),
      // A plugin that failed to load (no manifest) — must be filtered out.
      { manifest: null, loadError: 'manifest invalid', enabled: false, settings: {}, hookUnsubs: [], dir: '/x', serverModule: null },
    ];
    const app = new Hono();
    app.route('/', me);
    const res = await userReq(app, 'GET', '/v1/plugins');
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'slack');
    assert.equal(list[0].settings.botToken, undefined, 'writeOnly secret leaked to non-admin');
    assert.equal(list[0].settings.workspaceName, 'WS');
  });
});

describe('GET /v1/plugins/extension-points', () => {
  beforeEach(() => {
    db.getUserById = async (id) => id === 'usr_user' ? { userId: 'usr_user', role: 'user' } : null;
  });

  it('returns inventory shape for AI agents and tooling', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await userReq(app, 'GET', '/v1/plugins/extension-points');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.apiVersion, 'apiVersion present');
    assert.ok(Array.isArray(data.slots), 'slots is an array');
    assert.ok(Array.isArray(data.capabilities.static), 'capabilities.static is an array');
    assert.ok(data.docs.authoring, 'docs link present');
  });

  it('requires auth', async () => {
    const app = new Hono();
    app.route('/', me);
    const res = await app.request('/v1/plugins/extension-points');
    assert.equal(res.status, 401);
  });
});

process.on('exit', () => { console.error = origErr; console.warn = origWarn; console.log = origLog; });
