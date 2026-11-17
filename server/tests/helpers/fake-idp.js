/**
 * A local OpenID Connect provider for tests: discovery, JWKS, and a token
 * endpoint that checks the client secret, the redirect URI, and the PKCE
 * verifier like a real one, and signs real RS256 ID tokens. Shaped like
 * Microsoft Entra v2 (`/<tenant>/v2.0`).
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

export async function startFakeIdp({ tenant, clientId, clientSecret }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256'); // a key the JWKS doesn't publish
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map(); // code -> { claims, challenge, redirectUri, tamper }
  let base;
  const issuer = () => `${base}/${tenant}/v2.0`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === `/${tenant}/v2.0/.well-known/openid-configuration`) {
      return json(200, { issuer: issuer(), authorization_endpoint: `${base}/${tenant}/authorize`, token_endpoint: `${base}/${tenant}/token`, jwks_uri: `${base}/${tenant}/keys` });
    }
    if (url.pathname === `/${tenant}/keys`) return json(200, { keys: [jwk] });
    if (url.pathname === `/${tenant}/token` && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const entry = codes.get(form.get('code'));
      codes.delete(form.get('code')); // single use
      if (!entry || form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret || form.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant' });
      const challenge = createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (challenge !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const t = entry.tamper || {};
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ tid: tenant, ...entry.claims, nonce: t.nonce ?? entry.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(t.issuer ?? issuer()).setAudience(t.audience ?? clientId)
        .setIssuedAt(now).setExpirationTime(t.expired ? now - 3600 : now + 600)
        .sign(t.wrongKey ? other.privateKey : privateKey);
      return json(200, { token_type: 'Bearer', id_token: idToken });
    }
    return json(404, { error: 'not_found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    issuer,
    /** What the provider does after the person signs in: mint a code for this authorize request. */
    approve(authorizeUrl, claims, tamper) {
      const q = new URL(authorizeUrl).searchParams;
      const code = randomBytes(12).toString('hex');
      codes.set(code, { claims, challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), nonce: q.get('nonce'), tamper });
      return { code, state: q.get('state') };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
