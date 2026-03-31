import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssetURL } from '../js/platform.js';

describe('resolveAssetURL', () => {
  it('returns the relative path unchanged', () => {
    assert.equal(resolveAssetURL('prompts/coach.md'), 'prompts/coach.md');
    assert.equal(resolveAssetURL('lib/sql-wasm.wasm'), 'lib/sql-wasm.wasm');
    assert.equal(resolveAssetURL('data/courses/index.json'), 'data/courses/index.json');
  });
});
