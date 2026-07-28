import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withCachedSystem, MIN_CACHEABLE_TOKENS } from '../../src/lib/prompt-cache.js';

const CLAUDE = 'claude-haiku-4-5-20251001';
// Comfortably above the 4096-token minimum (4 chars/token estimate).
const LONG = 'x'.repeat(MIN_CACHEABLE_TOKENS * 4 + 100);
const SHORT = 'You are helpful.';

describe('withCachedSystem', () => {
  it('marks a long Claude system prompt as cacheable', () => {
    const result = withCachedSystem(LONG, CLAUDE);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
    assert.equal(result[0].text, LONG);
    assert.deepEqual(result[0].cache_control, { type: 'ephemeral' });
  });

  it('leaves a short prompt as a plain string', () => {
    // Below the minimum cacheable prefix, Bedrock silently ignores
    // cache_control — tagging it would pay the write premium for no reads.
    assert.equal(withCachedSystem(SHORT, CLAUDE), SHORT);
  });

  it('does not tag prompts for non-Anthropic models', () => {
    // cache_control is an Anthropic Messages API field; open-weight models
    // served via Converse reject or ignore it.
    assert.equal(withCachedSystem(LONG, 'qwen.qwen3-235b-a22b-2507-v1:0'), LONG);
    assert.equal(withCachedSystem(LONG, 'moonshotai.kimi-k2.5'), LONG);
  });

  it('passes through a caller-built block array untouched', () => {
    const blocks = [{ type: 'text', text: LONG }];
    assert.equal(withCachedSystem(blocks, CLAUDE), blocks);
  });

  it('passes through undefined and non-string values', () => {
    assert.equal(withCachedSystem(undefined, CLAUDE), undefined);
    assert.equal(withCachedSystem(null, CLAUDE), null);
  });

  it('handles a missing or non-string model without throwing', () => {
    assert.equal(withCachedSystem(LONG, undefined), LONG);
    assert.equal(withCachedSystem(LONG, null), LONG);
  });

  it('tags the exact boundary length', () => {
    const atMin = 'x'.repeat(MIN_CACHEABLE_TOKENS * 4);
    assert.ok(Array.isArray(withCachedSystem(atMin, CLAUDE)));
    const belowMin = 'x'.repeat(MIN_CACHEABLE_TOKENS * 4 - 1);
    assert.equal(withCachedSystem(belowMin, CLAUDE), belowMin);
  });
});
