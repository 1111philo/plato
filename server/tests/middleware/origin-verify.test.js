/**
 * Only CloudFront may reach the app (src/middleware/originVerify.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { originVerify, ORIGIN_VERIFY_HEADER } from '../../src/middleware/originVerify.js';

function app() {
  const a = new Hono();
  a.use('*', originVerify);
  a.get('/v1/health', (c) => c.json({ ok: true }));
  a.post('/v1/auth/login', (c) => c.json({ ok: true }));
  return a;
}
const req = (path, headers = {}, method = 'GET') => app().request(path, { method, headers });

describe('origin verify', () => {
  afterEach(() => { delete process.env.ORIGIN_VERIFY; });

  it('is off when unset or "off" (local dev, installs without CloudFront)', async () => {
    assert.equal((await req('/v1/health')).status, 200);
    process.env.ORIGIN_VERIFY = 'off';
    assert.equal((await req('/v1/health')).status, 200);
    process.env.ORIGIN_VERIFY = 'OFF ';
    assert.equal((await req('/v1/health')).status, 200);
  });

  it('refuses requests without the secret (direct Function URL / API Gateway calls)', async () => {
    process.env.ORIGIN_VERIFY = 's3cret-value';
    for (const headers of [{}, { [ORIGIN_VERIFY_HEADER]: '' }, { [ORIGIN_VERIFY_HEADER]: 's3cret-valuX' }, { [ORIGIN_VERIFY_HEADER]: 's3cret' }]) {
      const res = await req('/v1/auth/login', headers, 'POST');
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: 'Forbidden', code: 'origin_not_verified' });
    }
    assert.equal((await req('/v1/health')).status, 403, 'every route, health too');
  });

  it('lets CloudFront through, and accepts either secret while rotating', async () => {
    process.env.ORIGIN_VERIFY = 'old-secret, new-secret';
    assert.equal((await req('/v1/auth/login', { [ORIGIN_VERIFY_HEADER]: 'old-secret' }, 'POST')).status, 200);
    assert.equal((await req('/v1/auth/login', { [ORIGIN_VERIFY_HEADER]: 'new-secret' }, 'POST')).status, 200);
    assert.equal((await req('/v1/health', { 'X-Plato-Origin-Verify': 'new-secret' })).status, 200, 'header name is case-insensitive');
  });
});
