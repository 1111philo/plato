/**
 * The SSO routes on an https deployment, where the transaction cookie is
 * `__Secure-plato_sso_tx`. Setting or clearing it without the Secure
 * attribute throws, which turned every failed sign-in into a 500 on the
 * first real deployment (the main suite runs over http, with the plain name).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';
import { Hono } from 'hono';
import { startFakeIdp } from '../helpers/fake-idp.js';

const DB = './data/test-sso-https.db';
const TENANT = '11111111-2222-3333-4444-555555555555';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB;
process.env.APP_URL = 'https://plato.example';
process.env.SKIP_EMAIL = 'true';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) unlinkSync(f);

const { default: sso } = await import('../../src/routes/sso.js');
const { _setProviders } = await import('../../src/lib/sso-providers.js');
const { provider: entra } = await import('../../../plugins/entra-sso/server/provider.js');

const origErr = console.error; const origWarn = console.warn; const origLog = console.log;
let idp; let logged = [];
const app = new Hono();
app.route('/', sso);
app.onError((err, c) => c.json({ error: 'Internal server error', message: err.message }, 500));

before(async () => {
  console.error = (...a) => { logged.push(a.join(' ')); }; console.warn = () => {}; console.log = () => {};
  idp = await startFakeIdp({ tenant: TENANT, clientId: 'client-1', clientSecret: 'the-right-secret' });
  // The deployment has the wrong secret: the provider refuses the token exchange.
  Object.assign(process.env, { SSO_ENTRA_TENANT_ID: TENANT, SSO_ENTRA_CLIENT_ID: 'client-1', SSO_ENTRA_CLIENT_SECRET: 'the-wrong-secret', SSO_ENTRA_DOMAINS: 'uic.edu', SSO_ENTRA_AUTHORITY: idp.base });
  _setProviders([{ ...entra, settings: {} }]);
});
after(async () => {
  await idp.close();
  console.error = origErr; console.warn = origWarn; console.log = origLog;
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) unlinkSync(f);
});

const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

describe('SSO over https', () => {
  it('uses the __Secure- cookie, and a failed sign-in goes back to the login page (never a 500)', async () => {
    const start = await app.request('/v1/auth/sso/entra/start');
    assert.equal(start.status, 302);
    const set = start.headers.get('set-cookie');
    assert.match(set, /^__Secure-plato_sso_tx=/);
    assert.match(set, /Secure/);
    const cookie = cookieFrom(start);
    const authorize = start.headers.get('location');
    assert.match(new URL(authorize).searchParams.get('redirect_uri'), /^https:\/\/plato\.example\/v1\/auth\/sso\/entra\/callback$/);

    // The provider approves, but the token exchange is refused (wrong client secret).
    const { code, state } = idp.approve(authorize, { oid: 'o1', sub: 's1', email: 'a@uic.edu' });
    const refused = await app.request(`/v1/auth/sso/entra/callback?code=${code}&state=${state}`, { headers: { cookie } });
    assert.equal(refused.status, 302, await refused.clone().text());
    assert.equal(refused.headers.get('location'), 'https://plato.example/login?sso=failed');
    assert.match(refused.headers.get('set-cookie'), /^__Secure-plato_sso_tx=;.*Secure/, 'the cookie is cleared, with Secure');
    // The log says why, with the provider's code and nothing secret.
    const line = logged.find((l) => l.includes('sso_callback_failed'));
    assert.match(line, /"reason":"token_exchange_failed"/);
    assert.match(line, /"detail":"invalid_grant"/);
    assert.ok(!line.includes('the-wrong-secret') && !line.includes(code));

    // Every other early exit clears the cookie too.
    for (const url of [`/v1/auth/sso/entra/callback?code=x&state=forged`, `/v1/auth/sso/entra/callback?error=access_denied&state=${state}`, `/v1/auth/sso/entra/callback?state=${state}`]) {
      const res = await app.request(url, { headers: { cookie } });
      assert.equal(res.status, 302, url);
      assert.match(res.headers.get('location'), /\/login\?sso=(expired|cancelled|failed)$/);
    }
    const exchange = await app.request('/v1/auth/sso/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ code: 'nope' }) });
    assert.equal(exchange.status, 400);
  });
});
