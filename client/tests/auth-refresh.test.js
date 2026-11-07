/**
 * Token refresh (#451 scale review H1): parallel requests that find the
 * access token expiring share one refresh, and a request refreshes before
 * the token runs out instead of after a 401.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};
const jwt = (expSecondsFromNow) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString('base64url')}.s`;
const FRESH = jwt(15 * 60);

let calls;
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), auth: opts.headers?.Authorization });
  if (String(url).endsWith('/v1/auth/refresh')) {
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, json: async () => ({ accessToken: FRESH, refreshToken: 'rt_2' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

const { authenticatedFetch, accessTokenExpiresAt } = await import('../js/auth.js');

beforeEach(() => {
  calls = [];
  store.plato_auth = JSON.stringify({ accessToken: jwt(30), refreshToken: 'rt_1' }); // expires in 30 s
});

describe('token refresh', () => {
  it('reads the expiry from the token', () => {
    assert.ok(Math.abs(accessTokenExpiresAt(FRESH) - (Date.now() + 15 * 60 * 1000)) < 2000);
    assert.equal(accessTokenExpiresAt('not-a-jwt'), 0);
  });

  it('parallel requests near expiry make one refresh, then all use the new token', async () => {
    await Promise.all([authenticatedFetch('/v1/a'), authenticatedFetch('/v1/b'), authenticatedFetch('/v1/c')]);
    assert.equal(calls.filter((c) => c.url.endsWith('/v1/auth/refresh')).length, 1);
    const reqs = calls.filter((c) => !c.url.endsWith('/v1/auth/refresh'));
    assert.equal(reqs.length, 3);
    for (const r of reqs) assert.equal(r.auth, `Bearer ${FRESH}`);
    assert.equal(JSON.parse(store.plato_auth).refreshToken, 'rt_2');
  });

  it('a token with plenty of time left is used as is', async () => {
    store.plato_auth = JSON.stringify({ accessToken: FRESH, refreshToken: 'rt_2' });
    await authenticatedFetch('/v1/a');
    assert.deepEqual(calls.map((c) => c.url), ['/v1/a']);
  });
});
