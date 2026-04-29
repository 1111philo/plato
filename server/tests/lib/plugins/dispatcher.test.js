import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { makePluginDispatcher, makeSlackLegacyShim } from '../../../src/lib/plugins/dispatcher.js';

// Build a minimal plugin Hono router for the fake registry to dispatch into.
function buildSlackLikeRouter() {
  const r = new Hono();
  r.post('/admin/test', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.botToken) return c.json({ error: 'botToken is required' }, 400);
    return c.json({ ok: true, team: 'echoed' });
  });
  r.get('/admin/users', (c) => c.json({ q: c.req.query('q') || '' }));
  return r;
}

function buildRegistry({ enabled = true, hasModule = true, missing = false } = {}) {
  const routes = hasModule ? buildSlackLikeRouter() : null;
  const entry = missing ? undefined : {
    manifest: { id: 'slack' },
    enabled,
    serverModule: hasModule ? { routes } : null,
  };
  return {
    get(id) { return id === 'slack' ? entry : undefined; },
  };
}

function appWith(handler, pattern = '/v1/plugins/:pluginId/*') {
  const app = new Hono();
  app.all(pattern, handler);
  return app;
}

describe('makePluginDispatcher (catch-all)', () => {
  it('dispatches GET to the plugin\'s router with prefix stripped', async () => {
    const reg = buildRegistry();
    const app = appWith(makePluginDispatcher(reg));
    const res = await app.request('/v1/plugins/slack/admin/users?q=alice');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.q, 'alice');
  });

  it('forwards POST body to the plugin\'s router', async () => {
    const reg = buildRegistry();
    const app = appWith(makePluginDispatcher(reg));
    const res = await app.request('/v1/plugins/slack/admin/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: 'xoxb-test' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.team, 'echoed');
  });

  it('returns 404 with "not installed" for unknown plugins', async () => {
    const reg = buildRegistry({ missing: true });
    const app = appWith(makePluginDispatcher(reg));
    const res = await app.request('/v1/plugins/slack/admin/test');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /not installed/);
  });

  it('returns 404 with "disabled" when plugin is off', async () => {
    const reg = buildRegistry({ enabled: false });
    const app = appWith(makePluginDispatcher(reg));
    const res = await app.request('/v1/plugins/slack/admin/test');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /disabled/);
  });

  it('returns 404 with "no server routes" for client-only plugins', async () => {
    const reg = buildRegistry({ hasModule: false });
    const app = appWith(makePluginDispatcher(reg));
    const res = await app.request('/v1/plugins/slack/admin/test');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /no server routes/);
  });

  it('forwards 404 from the inner plugin router for unknown plugin paths', async () => {
    const reg = buildRegistry();
    const app = appWith(makePluginDispatcher(reg));
    const res = await app.request('/v1/plugins/slack/admin/missing-route');
    // Inner router has no /admin/missing-route → Hono's default 404
    assert.equal(res.status, 404);
  });
});

describe('makeSlackLegacyShim', () => {
  it('rewrites /v1/admin/slack/* to /admin/* and dispatches to the Slack plugin', async () => {
    const reg = buildRegistry();
    const app = appWith(makeSlackLegacyShim(reg), '/v1/admin/slack/*');
    const res = await app.request('/v1/admin/slack/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: 'xoxb-test' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
  });

  it('returns 404 when Slack plugin is disabled', async () => {
    const reg = buildRegistry({ enabled: false });
    const app = appWith(makeSlackLegacyShim(reg), '/v1/admin/slack/*');
    const res = await app.request('/v1/admin/slack/test');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /not available/);
  });

  it('returns 404 when Slack plugin is not installed', async () => {
    const reg = buildRegistry({ missing: true });
    const app = appWith(makeSlackLegacyShim(reg), '/v1/admin/slack/*');
    const res = await app.request('/v1/admin/slack/test');
    assert.equal(res.status, 404);
  });
});
