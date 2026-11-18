/**
 * Single sign-on helpers (src/lib/sso.js): the start URL, the code in the
 * URL fragment, the words for each failure, and the one-shot exchange.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  providerName, ssoStartUrl, ssoCodeFromHash, ssoReasonMessage, ssoErrorMessage, exchangeSsoCode, fetchSsoProviders,
} from '../src/lib/sso.js';

const UIC = [{ id: 'entra', label: 'Sign in with UIC' }];

describe('providerName', () => {
  it('takes the name out of a button label', () => {
    assert.equal(providerName('Sign in with UIC'), 'UIC');
    assert.equal(providerName('Continue with Microsoft'), 'Microsoft');
    assert.equal(providerName('  log in using Campus ID '), 'Campus ID');
  });
  it('uses a label of another shape whole, and has a fallback', () => {
    assert.equal(providerName('UIC NetID'), 'UIC NetID');
    assert.equal(providerName(''), 'single sign-on');
    assert.equal(providerName(undefined), 'single sign-on');
  });
});

describe('ssoStartUrl', () => {
  it('is the bare start route by default', () => {
    assert.equal(ssoStartUrl('entra'), '/v1/auth/sso/entra/start');
  });
  it('carries a local next path and the invite token', () => {
    assert.equal(ssoStartUrl('entra', { next: '/lessons/a b', invite: 'tok_123' }), '/v1/auth/sso/entra/start?next=%2Flessons%2Fa+b&invite=tok_123');
  });
  it('drops a next that is not a local path', () => {
    assert.equal(ssoStartUrl('entra', { next: 'https://evil.example' }), '/v1/auth/sso/entra/start');
    assert.equal(ssoStartUrl('entra', { next: '//evil.example' }), '/v1/auth/sso/entra/start');
  });
});

describe('ssoCodeFromHash', () => {
  it('reads the code', () => {
    assert.equal(ssoCodeFromHash('#code=abcDEF_123-xyz'), 'abcDEF_123-xyz');
  });
  it('is null for no code or a malformed one', () => {
    assert.equal(ssoCodeFromHash(''), null);
    assert.equal(ssoCodeFromHash('#other=1'), null);
    assert.equal(ssoCodeFromHash('#code=short'), null);
    assert.equal(ssoCodeFromHash('#code=has spaces and <tags>'), null);
  });
});

describe('ssoReasonMessage', () => {
  it('has a message for each reason the server sends', () => {
    assert.equal(ssoReasonMessage('cancelled', UIC), 'Sign-in was cancelled.');
    assert.equal(ssoReasonMessage('expired', UIC), 'That sign-in took too long. Please try again.');
    assert.equal(ssoReasonMessage('refused', UIC), 'We couldn’t sign you in with UIC. Try again, or use your email and password.');
    assert.equal(ssoReasonMessage('failed', UIC), ssoReasonMessage('refused', UIC));
    assert.equal(ssoReasonMessage('unavailable', UIC), 'Signing in with UIC isn’t available right now.');
  });
  it('doesn’t name a provider when there isn’t exactly one', () => {
    assert.equal(ssoReasonMessage('unavailable', []), 'Single sign-on isn’t available right now.');
    assert.equal(ssoReasonMessage('failed', [...UIC, { id: 'g', label: 'Sign in with Google' }]), 'We couldn’t sign you in with single sign-on. Try again, or use your email and password.');
  });
  it('is empty for no reason or one it doesn’t know (the param is attacker-typed)', () => {
    assert.equal(ssoReasonMessage(null, UIC), '');
    assert.equal(ssoReasonMessage('<script>', UIC), '');
  });
});

describe('ssoErrorMessage', () => {
  it('names the provider where it helps', () => {
    assert.match(ssoErrorMessage('account_has_identity', 'Sign in with UIC'), /^This account is already connected to a different UIC identity\./);
    assert.equal(ssoErrorMessage('identity_in_use', 'Sign in with UIC'), 'That UIC account is already connected to another plato account.');
    assert.match(ssoErrorMessage('account_exists', 'Sign in with UIC'), /then connect UIC in Settings\.$/);
  });
  it('covers the invite codes', () => {
    assert.match(ssoErrorMessage('invite_invalid', 'x'), /^This invite can’t be used\./);
    assert.equal(ssoErrorMessage('invite_full', 'x'), 'This invite link has reached its limit.');
  });
  it('falls back to a generic message', () => {
    for (const code of ['no_email', 'try_again', 'failed', undefined]) {
      assert.equal(ssoErrorMessage(code, 'x'), 'Something went wrong signing you in. Please try again.');
    }
  });
});

describe('exchangeSsoCode', () => {
  const ok = (body) => ({ ok: true, json: async () => body });

  it('posts the code once, however many times it is asked', async () => {
    let calls = 0;
    const fetchImpl = async (url, init) => {
      calls++;
      assert.equal(url, '/v1/auth/sso/exchange');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { code: 'code-once-1' });
      return ok({ outcome: 'linked', label: 'Sign in with UIC' });
    };
    const [a, b] = await Promise.all([exchangeSsoCode('code-once-1', fetchImpl), exchangeSsoCode('code-once-1', fetchImpl)]);
    assert.equal(calls, 1);
    assert.equal(a.outcome, 'linked');
    assert.equal(a, b);
  });
  it('is "expired" for a 400, a network failure, or a body with no outcome', async () => {
    assert.deepEqual(await exchangeSsoCode('code-400-aaaa', async () => ({ ok: false, status: 400, json: async () => ({ code: 'sso_expired' }) })), { outcome: 'expired' });
    assert.deepEqual(await exchangeSsoCode('code-net-aaaa', async () => { throw new Error('offline'); }), { outcome: 'expired' });
    assert.deepEqual(await exchangeSsoCode('code-odd-aaaa', async () => ok({})), { outcome: 'expired' });
  });
});

describe('fetchSsoProviders', () => {
  it('is empty when the request fails, and drops malformed entries', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('offline'); };
      assert.deepEqual(await fetchSsoProviders(), []);
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ providers: [{ id: 'entra', label: 'Sign in with UIC' }, { id: 'x' }, null] }) });
      assert.deepEqual(await fetchSsoProviders(), UIC);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('localPath', () => {
  it('keeps a path on this site and refuses anything that could leave it', async () => {
    const { localPath } = await import('../src/lib/sso.js');
    const o = 'https://plato.example';
    assert.equal(localPath('/lessons/abc?x=1#top', '/lessons', o), '/lessons/abc?x=1#top');
    for (const bad of ['/\t/evil.example/x', '/\n/evil.example', '//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', '/', null, '/a b']) {
      assert.equal(localPath(bad, '/lessons', o), '/lessons', JSON.stringify(bad));
    }
  });
});
