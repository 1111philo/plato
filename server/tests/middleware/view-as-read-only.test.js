/**
 * View-as-User is read-only for every route: any write carrying
 * X-Plato-View-As is rejected before routing, except leaving the session,
 * refreshing the token, and logging out.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { viewAsReadOnly } from '../../src/middleware/viewAsReadOnly.js';

function makeApp() {
  const app = new Hono();
  app.use('*', viewAsReadOnly);
  app.all('*', (c) => c.json({ reached: true }));
  return app;
}
const req = (method, path, viewAs = 'usr_target') => makeApp().request(path, {
  method,
  headers: viewAs ? { 'X-Plato-View-As': viewAs } : {},
});

describe('viewAsReadOnly', () => {
  it('lets every request through without the header', async () => {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await req(m, '/v1/sync/profile', null)).status, 200, m);
    }
  });

  it('allows reads during a session', async () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal((await req(m, '/v1/sync')).status, 200, m);
  });

  it('rejects every write during a session, on any route', async () => {
    for (const [m, p] of [['PUT', '/v1/sync/lessonKB:x'], ['DELETE', '/v1/sync'], ['PATCH', '/v1/me'], ['POST', '/v1/ai/messages'], ['POST', '/v1/admin/invites'], ['PUT', '/v1/plugins/slack/admin/x']]) {
      const res = await req(m, p);
      assert.equal(res.status, 403, `${m} ${p}`);
      assert.equal((await res.json()).code, 'view_as_read_only');
    }
  });

  it('still allows leaving the session, refreshing the token, and logging out', async () => {
    for (const p of ['/v1/admin/impersonation/end', '/v1/auth/refresh', '/v1/auth/logout']) {
      assert.equal((await req('POST', p)).status, 200, p);
    }
  });
});
