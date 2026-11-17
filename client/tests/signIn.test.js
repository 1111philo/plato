/**
 * Admin → Users sign-in labels (src/lib/signIn.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { providerName, signInMethods, ssoInPlay } from '../src/lib/signIn.js';

const PROVIDERS = [{ id: 'entra', label: 'Sign in with UIC' }];

describe('providerName', () => {
  it('shortens the button label', () => {
    assert.equal(providerName('entra', PROVIDERS), 'UIC');
    assert.equal(providerName('entra', [{ id: 'entra', label: 'Sign in with Microsoft' }]), 'Microsoft');
    assert.equal(providerName('entra', [{ id: 'entra', label: 'log in with Campus ID' }]), 'Campus ID');
    assert.equal(providerName('entra', [{ id: 'entra', label: 'Campus account' }]), 'Campus account');
  });
  it('falls back to SSO for a provider that is off, unknown, or unlabeled', () => {
    assert.equal(providerName('entra', []), 'SSO');
    assert.equal(providerName('other', PROVIDERS), 'SSO');
    assert.equal(providerName('entra'), 'SSO');
    assert.equal(providerName('entra', [{ id: 'entra', label: 'Sign in with ' }]), 'SSO');
    assert.equal(providerName('entra', [{ id: 'entra' }]), 'SSO');
  });
});

describe('signInMethods', () => {
  const sso = { provider: 'entra', email: 'a@uic.edu', linkedAt: '2026-11-01T00:00:00Z' };
  it('lists password, the provider, or both', () => {
    assert.deepEqual(signInMethods({ hasPassword: true, sso: null }, PROVIDERS), ['Password']);
    assert.deepEqual(signInMethods({ hasPassword: false, sso }, PROVIDERS), ['UIC']);
    assert.deepEqual(signInMethods({ hasPassword: true, sso }, PROVIDERS), ['Password', 'UIC']);
    assert.deepEqual(signInMethods({ hasPassword: true, sso }, []), ['Password', 'SSO']);
  });
  it('treats a row with no hasPassword as a password account, and no user as nothing', () => {
    assert.deepEqual(signInMethods({}), ['Password']);
    assert.deepEqual(signInMethods(null), []);
    assert.deepEqual(signInMethods({ hasPassword: false, sso: null }), []);
  });
});

describe('ssoInPlay', () => {
  it('is on when a provider is live or any user is linked', () => {
    assert.equal(ssoInPlay([{ sso: null }], []), false);
    assert.equal(ssoInPlay([], []), false);
    assert.equal(ssoInPlay(), false);
    assert.equal(ssoInPlay([{ sso: null }], PROVIDERS), true);
    assert.equal(ssoInPlay([{ sso: null }, { sso: { provider: 'entra' } }], []), true);
  });
});
