/**
 * The Entra provider's two decisions: when it's configured, and which emails
 * the tenant vouches for (plugins/entra-sso/server/provider.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configure, mapClaims } from '../../../plugins/entra-sso/server/provider.js';

const T = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENV = { SSO_ENTRA_TENANT_ID: T.toUpperCase(), SSO_ENTRA_CLIENT_ID: 'cid', SSO_ENTRA_CLIENT_SECRET: 'sec', SSO_ENTRA_DOMAINS: ' UIC.edu, @uillinois.edu ' };

describe('entra provider', () => {
  it('is configured only with a GUID tenant, a client id, and a secret', () => {
    const cfg = configure(ENV, { buttonLabel: ' Sign in with UIC ' });
    assert.equal(cfg.issuer, `https://login.microsoftonline.com/${T}/v2.0`);
    assert.deepEqual(cfg.domains, ['uic.edu', 'uillinois.edu']);
    assert.equal(cfg.label, 'Sign in with UIC');
    assert.equal(configure(ENV).label, 'Sign in with Microsoft');
    for (const bad of [{ SSO_ENTRA_TENANT_ID: 'common' }, { SSO_ENTRA_TENANT_ID: 'organizations' }, { SSO_ENTRA_TENANT_ID: '' }, { SSO_ENTRA_CLIENT_ID: '' }, { SSO_ENTRA_CLIENT_SECRET: ' ' }]) {
      assert.equal(configure({ ...ENV, ...bad }), null, JSON.stringify(bad));
    }
    assert.equal(configure({}), null);
  });

  const cfg = configure(ENV);
  const base = { tid: T, oid: 'o1', sub: 's1', given_name: 'Ada', family_name: 'L' };

  it('vouches only for addresses in the tenant’s domains', () => {
    assert.deepEqual(mapClaims({ ...base, email: 'Ada.L@UIC.edu', preferred_username: 'adal2@uic.edu' }, cfg).emails, ['ada.l@uic.edu', 'adal2@uic.edu']);
    const guest = mapClaims({ ...base, email: 'ada@gmail.com', preferred_username: 'ada_gmail.com#EXT#@uic.onmicrosoft.com' }, cfg);
    assert.deepEqual(guest.emails, []);
    assert.equal(guest.email, 'ada@gmail.com', 'shown, but matches nothing');
    assert.deepEqual(mapClaims({ ...base, email: 'ada@uic.edu.evil.org' }, cfg).emails, []);
    assert.deepEqual(mapClaims({ ...base, email: 'ada@uic.edu', xms_edov: false, preferred_username: 'x@elsewhere.org' }, cfg).emails, []);
    assert.deepEqual(mapClaims({ ...base, email: 'not-an-email' }, cfg).emails, []);
    assert.deepEqual(mapClaims({ ...base, email: 'ada@uic.edu' }, { ...cfg, domains: [] }).emails, [], 'no owned domains: match nothing');
  });

  it('uses the directory object id as the subject, and refuses another tenant or a token with no subject', () => {
    assert.equal(mapClaims({ ...base, email: 'a@uic.edu' }, cfg).subject, 'o1');
    assert.equal(mapClaims({ tid: T, sub: 's1' }, cfg).subject, 's1');
    assert.throws(() => mapClaims({ ...base, tid: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' }, cfg), (e) => e.code === 'identity_refused');
    assert.throws(() => mapClaims({ tid: T }, cfg), (e) => e.code === 'identity_refused');
  });
});
