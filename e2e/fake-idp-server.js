// A stand-in identity provider for the e2e suite's single sign-on tests
// (tests/sso.spec.js). It is the unit tests' fake (server/tests/helpers/
// fake-idp.js: real RS256 tokens, PKCE, client secret and redirect URI all
// checked) on a fixed port, with an authorize endpoint that approves at once
// instead of showing a sign-in page.
//
// Who "signs in" is whatever the test set beforehand:
//   POST /__control/next  { claims: { oid, email, given_name, … } }   that person
//   POST /__control/next  { cancel: true }                            they pressed Cancel
// The choice is used once. With nothing set, authorize answers as a cancel.
//
// Started by playwright.config.js. Never part of a deployment.
import { startFakeIdp } from '../server/tests/helpers/fake-idp.js';

const tenant = process.env.SSO_ENTRA_TENANT_ID;
const clientId = process.env.SSO_ENTRA_CLIENT_ID;
const clientSecret = process.env.SSO_ENTRA_CLIENT_SECRET;
const port = Number(process.env.FAKE_IDP_PORT || 3491);
if (!tenant || !clientId || !clientSecret) throw new Error('SSO_ENTRA_TENANT_ID, SSO_ENTRA_CLIENT_ID and SSO_ENTRA_CLIENT_SECRET are required');

let next = null;

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

const idp = await startFakeIdp({
  tenant, clientId, clientSecret, port,
  async onRequest(req, res, url, self) {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); return true; };
    if (url.pathname === '/health') return json(200, { ok: true });
    if (url.pathname === '/__control/next' && req.method === 'POST') {
      const body = await readJson(req);
      next = body.cancel ? { cancel: true } : body.claims ? { claims: body.claims } : null;
      return json(200, { ok: true });
    }
    if (url.pathname === `/${tenant}/authorize` && req.method === 'GET') {
      const redirectUri = url.searchParams.get('redirect_uri');
      if (url.searchParams.get('client_id') !== clientId || !redirectUri) return json(400, { error: 'invalid_request' });
      const choice = next;
      next = null;
      const back = new URL(redirectUri);
      if (choice?.claims) {
        const { code, state } = self.approve(url.href, choice.claims);
        back.searchParams.set('code', code);
        back.searchParams.set('state', state);
      } else {
        back.searchParams.set('error', 'access_denied');
        back.searchParams.set('state', url.searchParams.get('state') || '');
      }
      res.writeHead(302, { Location: back.href });
      res.end();
      return true;
    }
    return false;
  },
});

console.log(`fake identity provider on ${idp.base} (issuer ${idp.issuer()})`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => idp.close().then(() => process.exit(0)));
