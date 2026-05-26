import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl, assertSafeHost, isBlockedIp, safeLookup, LinkError } from '../../src/lib/url-guard.js';

describe('assertSafeUrl', () => {
  it('accepts plain http/https URLs and returns a URL', () => {
    assert.equal(assertSafeUrl('https://example.com/post').hostname, 'example.com');
    assert.equal(assertSafeUrl('http://example.com:8080/x').port, '8080');
  });

  it('rejects non-http(s) schemes', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x', 'data:text/html,hi']) {
      assert.throws(() => assertSafeUrl(bad), (e) => e instanceof LinkError && e.code === 'bad_scheme');
    }
  });

  it('rejects embedded credentials', () => {
    assert.throws(() => assertSafeUrl('http://user:pass@example.com'), (e) => e.code === 'bad_url');
  });

  it('rejects unusual ports', () => {
    assert.throws(() => assertSafeUrl('http://example.com:22/'), (e) => e.code === 'bad_port');
  });

  it('rejects garbage', () => {
    assert.throws(() => assertSafeUrl('not a url'), (e) => e.code === 'invalid_url');
  });
});

describe('isBlockedIp', () => {
  it('blocks loopback, private, link-local, and the cloud metadata IP', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255']) {
      assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
    }
  });

  it('blocks IPv6 loopback, ULA, link-local, and IPv4-mapped internals', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:169.254.169.254']) {
      assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
    }
  });

  it('blocks alternate IPv6 representations of internal addresses (normalization)', () => {
    for (const ip of [
      '::ffff:7f00:1',                  // hex-form IPv4-mapped 127.0.0.1
      '0:0:0:0:0:ffff:127.0.0.1',       // fully-expanded IPv4-mapped
      '0:0:0:0:0:ffff:7f00:0001',       // expanded hex, zero-padded
      '::ffff:a9fe:a9fe',               // hex-form 169.254.169.254
      '[::1]',                          // bracketed (URL hostname form)
      'fe80::1%eth0',                   // zone id
    ]) {
      assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`);
    }
  });

  it('allows ordinary public addresses', () => {
    assert.equal(isBlockedIp('93.184.216.34'), false);
    assert.equal(isBlockedIp('8.8.8.8'), false);
    assert.equal(isBlockedIp('2606:2800:220:1::1'), false);
  });

  it('blocks anything that is not a valid IP', () => {
    assert.equal(isBlockedIp('not-an-ip'), true);
  });
});

describe('assertSafeHost', () => {
  it('passes a public IP literal without a DNS lookup', async () => {
    await assert.doesNotReject(assertSafeHost('93.184.216.34'));
  });

  it('rejects an internal IP literal', async () => {
    await assert.rejects(assertSafeHost('169.254.169.254'), (e) => e.code === 'blocked_host');
    await assert.rejects(assertSafeHost('127.0.0.1'), (e) => e.code === 'blocked_host');
  });
});

describe('safeLookup (connection-time SSRF guard, closes DNS rebinding)', () => {
  const run = (host, opts = {}) => new Promise((resolve) => {
    safeLookup(host, opts, (err, address, family) => resolve({ err, address, family }));
  });

  it('errors when the host resolves to a blocked address', async () => {
    const { err } = await run('127.0.0.1');
    assert.ok(err instanceof LinkError && err.code === 'blocked_host');
  });

  it('errors for localhost (resolves to loopback)', async () => {
    const { err } = await run('localhost');
    assert.ok(err instanceof LinkError && err.code === 'blocked_host');
  });

  it('returns the validated address for a public IP literal', async () => {
    const { err, address } = await run('93.184.216.34');
    assert.equal(err, null);
    assert.equal(address, '93.184.216.34');
  });

  it('returns the array form when called with all:true (undici contract)', async () => {
    const { err, address: list } = await run('93.184.216.34', { all: true });
    assert.equal(err, null);
    assert.ok(Array.isArray(list) && list[0].address === '93.184.216.34');
  });
});
