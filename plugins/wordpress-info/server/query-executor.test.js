import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_HOSTS } from './sources.js';

// Note: These are unit tests for the query executor logic.
// Integration tests that hit real APIs would be slow and fragile,
// so we test the internal logic and SSRF defense here.

describe('WordPress Info query executor', () => {
  it('ALLOWED_HOSTS covers all source hosts', async () => {
    // This is a critical security test: every source we query MUST be
    // in the allowlist. If a source is added without updating ALLOWED_HOSTS,
    // this test will catch it.
    const { SOURCES } = await import('./sources.js');

    for (const source of SOURCES) {
      const url = new URL(source.base);
      assert.ok(
        ALLOWED_HOSTS.includes(url.hostname),
        `Source ${source.id} (${url.hostname}) is not in ALLOWED_HOSTS. Add it to sources.js.`
      );
    }
  });

  it('ALLOWED_HOSTS is minimal and well-known', () => {
    // Verify we're only allowing the expected WordPress.org and GitHub hosts
    const expected = [
      'developer.wordpress.org',
      'make.wordpress.org',
      'api.github.com',
    ];

    assert.deepEqual(
      ALLOWED_HOSTS.sort(),
      expected.sort(),
      'ALLOWED_HOSTS should only contain well-known WordPress and GitHub hosts'
    );
  });

  it('source kinds are valid', async () => {
    const { SOURCES } = await import('./sources.js');
    const validKinds = ['wporg-docs', 'make-blogs', 'github-code'];

    for (const source of SOURCES) {
      assert.ok(
        validKinds.includes(source.kind),
        `Source ${source.id} has invalid kind: ${source.kind}`
      );
    }
  });

  it('all sources have required fields', async () => {
    const { SOURCES } = await import('./sources.js');

    for (const source of SOURCES) {
      assert.ok(source.id, `Source missing id: ${JSON.stringify(source)}`);
      assert.ok(source.label, `Source ${source.id} missing label`);
      assert.ok(source.kind, `Source ${source.id} missing kind`);
      assert.ok(source.base, `Source ${source.id} missing base URL`);

      // Verify base is a valid URL
      assert.doesNotThrow(
        () => new URL(source.base),
        `Source ${source.id} has invalid base URL: ${source.base}`
      );

      // GitHub sources need a repo field
      if (source.kind === 'github-code') {
        assert.ok(
          source.repo,
          `GitHub source ${source.id} missing repo field`
        );
        assert.match(
          source.repo,
          /^[\w-]+\/[\w-]+$/,
          `Source ${source.id} repo should be in owner/repo format`
        );
      }
    }
  });

  it('WordPress keywords are lowercase for case-insensitive matching', async () => {
    const { KEYWORDS } = await import('./sources.js');

    for (const keyword of KEYWORDS) {
      assert.equal(
        keyword,
        keyword.toLowerCase(),
        `Keyword "${keyword}" should be lowercase for case-insensitive matching`
      );
    }
  });

  it('query executor exports executeQueries function', async () => {
    const executor = await import('./query-executor.js');
    assert.equal(typeof executor.executeQueries, 'function');
  });
});
