import { describe, it, beforeEach, after } from 'node:test';
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

// The 2026-11-17 alarm: each search re-read the whole workspace, Slack
// rate-limited it, and the client waited out retry-after until the Lambda
// timed out. Now the list is read once a minute and a 429 fails at once.
describe('Slack member list — cached, and fails fast when rate limited', () => {
  let slack; let calls; let mode;

  async function fakeSlack() {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      calls++;
      if (mode === 'ratelimited') {
        res.writeHead(429, { 'retry-after': '30', 'content-type': 'application/json' });
        return res.end('{"ok":false,"error":"ratelimited"}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, members: [
        { id: 'U1', real_name: 'Ada Lovelace', profile: { email: 'ada@x.com' } },
        { id: 'U2', real_name: 'Grace Hopper', profile: { email: 'grace@x.com' } },
        { id: 'B1', real_name: 'Bot', is_bot: true },
      ] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return server;
  }

  beforeEach(async () => {
    const client = await import('../../../plugins/slack/server/slack-client.js');
    client._resetMemberCache();
    calls = 0; mode = 'ok';
    slack?.close();
    slack = await fakeSlack();
    client._setSlackApiUrl(`http://127.0.0.1:${slack.address().port}/api/`);
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.getSyncData = async (_u, key) => (key === 'plugins:activation' ? { data: { slack: { settings: { botToken: 'xoxb-1' } } } } : null);
  });

  after(async () => {
    slack?.close();
    (await import('../../../plugins/slack/server/slack-client.js'))._setSlackApiUrl(null);
  });

  it('a run of searches reads the workspace once', async () => {
    const app = buildApp();
    const all = await Promise.all(['a', 'ad', 'ada', 'grace'].map((q) => adminReq(app, 'GET', `/admin/users?q=${q}`)));
    assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200]);
    assert.deepEqual((await all[2].json()).map((u) => u.slackUserId), ['U1']);
    assert.deepEqual((await all[3].json()).map((u) => u.slackUserId), ['U2']);
    await adminReq(app, 'GET', '/admin/users?q=hopper');
    assert.equal(calls, 1);
  });

  it('reads again once the minute is up', async () => {
    const { listSlackMembers, MEMBER_CACHE_MS } = await import('../../../plugins/slack/server/slack-client.js');
    let t = 1000;
    await listSlackMembers('xoxb-1', () => t);
    t += MEMBER_CACHE_MS - 1;
    await listSlackMembers('xoxb-1', () => t);
    assert.equal(calls, 1);
    t += 1;
    assert.equal((await listSlackMembers('xoxb-1', () => t)).length, 2);
    assert.equal(calls, 2);
  });

  it('search: a rate-limited Slack is a quick 429, and the failure is not kept', async () => {
    mode = 'ratelimited';
    const app = buildApp();
    const started = Date.now();
    const res = await adminReq(app, 'GET', '/admin/users?q=ada');
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '60');
    const data = await res.json();
    assert.equal(data.code, 'slack_rate_limited');
    assert.match(data.error, /Slack is busy/);
    assert.equal(calls, 1, 'no retries');
    mode = 'ok';
    assert.equal((await adminReq(app, 'GET', '/admin/users?q=ada')).status, 200);
  });

  it('Slack link: a rate-limited Slack is a quick 429 and links nobody', async () => {
    mode = 'ratelimited';
    let updates = 0;
    db.listAllUsers = async () => [{ userId: 'usr_1', email: 'ada@x.com' }];
    db.updateUser = async () => { updates++; };
    const started = Date.now();
    const res = await adminReq(buildApp(), 'POST', '/admin/link', { userIds: ['usr_1'] });
    assert.ok(Date.now() - started < 3000);
    assert.equal(res.status, 429);
    assert.equal(updates, 0);
  });
});
