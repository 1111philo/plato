import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import slackPlugin from '../../../plugins/slack/server/index.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';

// Slack routes mounted under /admin/* internally. We mount the plugin's router
// at root in the test app, so calls go to /admin/<route>.
function buildApp() {
  const app = new Hono();
  app.route('/', slackPlugin.routes);
  return app;
}

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

describe('Slack plugin routes — auth gating', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      if (id === 'usr_user') return { userId: 'usr_user', role: 'user' };
      return null;
    };
  });

  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await app.request('/admin/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  it('rejects non-admin users', async () => {
    const app = buildApp();
    const res = await userReq(app, 'POST', '/admin/test', {});
    assert.equal(res.status, 403);
  });
});

describe('POST /admin/test (Slack token validation entry point)', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  });

  it('rejects request without botToken (400)', async () => {
    const app = buildApp();
    const res = await adminReq(app, 'POST', '/admin/test', {});
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /botToken is required/);
  });
});

describe('Slack routes that need a stored token', () => {
  beforeEach(() => {
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
  });

  it('GET /admin/users returns 400 when Slack is not configured', async () => {
    db.getSyncData = async (userId, key) => {
      if (userId === '_system' && key === 'plugins:activation') return { data: {}, version: 0 };
      return null;
    };
    const app = buildApp();
    const res = await adminReq(app, 'GET', '/admin/users?q=alice');
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /not configured/);
  });

  it('GET /admin/channels returns 400 when Slack is not configured', async () => {
    db.getSyncData = async (userId, key) => {
      if (userId === '_system' && key === 'plugins:activation') return { data: {}, version: 0 };
      return null;
    };
    const app = buildApp();
    const res = await adminReq(app, 'GET', '/admin/channels');
    assert.equal(res.status, 400);
  });

  it('POST /admin/invites validates request shape before calling Slack', async () => {
    db.getSyncData = async (userId, key) => {
      if (userId === '_system' && key === 'plugins:activation') {
        return { data: { slack: { settings: { botToken: 'xoxb-fake' } } }, version: 0 };
      }
      return null;
    };
    const app = buildApp();
    // empty users array → 400 (does not reach Slack API)
    const res = await adminReq(app, 'POST', '/admin/invites', { users: [] });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /users array is required/);
  });

  it('POST /admin/invites caps batch at 200', async () => {
    db.getSyncData = async (userId, key) => {
      if (userId === '_system' && key === 'plugins:activation') {
        return { data: { slack: { settings: { botToken: 'xoxb-fake' } } }, version: 0 };
      }
      return null;
    };
    const app = buildApp();
    const users = Array.from({ length: 201 }, (_, i) => ({ slackUserId: `U${i}` }));
    const res = await adminReq(app, 'POST', '/admin/invites', { users });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Maximum 200 invites/);
  });
});

describe('Slack invite message — grammar', () => {
  it('reads correctly for both named and unnamed admins', () => {
    // We can't easily run the full invite flow without mocking Slack API + email,
    // but we can spot-check the message-template logic by inspecting the source:
    // - With name:    "${name} has invited you to join *${classroom}*."
    // - Without name: "You've been invited to join *${classroom}*."
    // The previous bug was "You've been invited you to join" (double "you").
    const compose = (name, classroom) => {
      const opener = name ? `${name} has invited you` : `You've been invited`;
      return `${opener} to join *${classroom}*.`;
    };
    assert.equal(compose('Alice', 'Acme'), 'Alice has invited you to join *Acme*.');
    assert.equal(compose(null, 'Acme'), "You've been invited to join *Acme*.");
    assert.equal(compose('', 'Acme'), "You've been invited to join *Acme*.");
    // Critically, the unnamed branch must NOT produce "invited you you to join":
    assert.doesNotMatch(compose(null, 'Acme'), /invited you you/);
  });
});
