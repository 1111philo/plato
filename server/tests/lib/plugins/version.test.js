import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies } from '../../../src/lib/plugins/version.js';

describe('satisfies', () => {
  it('matches exact', () => {
    assert.equal(satisfies('1.0.0', '1.0.0'), true);
    assert.equal(satisfies('1.0.0', '1.0.1'), false);
  });

  it('matches caret', () => {
    assert.equal(satisfies('1.2.3', '^1.0.0'), true);
    assert.equal(satisfies('1.0.0', '^1.0.0'), true);
    assert.equal(satisfies('2.0.0', '^1.0.0'), false);
    assert.equal(satisfies('1.0.0', '^1.1.0'), false);
  });

  it('matches tilde', () => {
    assert.equal(satisfies('1.2.3', '~1.2.0'), true);
    assert.equal(satisfies('1.3.0', '~1.2.0'), false);
    assert.equal(satisfies('1.2.0', '~1.2.0'), true);
  });

  it('matches wildcards', () => {
    assert.equal(satisfies('1.5.0', '1.x'), true);
    assert.equal(satisfies('2.0.0', '1.x'), false);
    assert.equal(satisfies('1.2.0', '1.2.x'), true);
    assert.equal(satisfies('1.3.0', '1.2.x'), false);
  });

  it('rejects garbage', () => {
    assert.equal(satisfies('1.0.0', ''), false);
    assert.equal(satisfies('not-semver', '1.x'), false);
    assert.equal(satisfies('1.0.0', 'not-a-range'), false);
  });
});
