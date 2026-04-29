/**
 * Template: minimal vitest/node:test skeleton for a plugin route.
 *
 * Copy into plugins/<id>/server/index.test.js.
 *
 * Plato uses Node's built-in `node:test` runner (no jest/vitest dep). The
 * plugin's `routes` is a Hono app — call `routes.fetch(new Request(...))`
 * directly, no need to spin up an HTTP server.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import plugin from './index.js';

test('admin routes require auth', async () => {
  const res = await plugin.routes.fetch(new Request('http://t/admin/hello'));
  // No Authorization header → authenticate middleware returns 401.
  assert.equal(res.status, 401);
});

test('plugin exports the expected shape', () => {
  assert.ok(plugin.routes, 'routes export missing');
  assert.equal(typeof plugin.onActivate, 'function');
  assert.equal(typeof plugin.onDeactivate, 'function');
});
