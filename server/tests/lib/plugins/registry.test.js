import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../../../src/lib/plugins/registry.js';
import ai, { LLM } from '../../../src/lib/ai-provider.js';

const origWarn = console.warn;
console.warn = () => {};
after(() => { console.warn = origWarn; });

describe('buildContext — ctx.ai and ctx.LLM', () => {
  it('provides ctx.ai as the host ai provider instance', () => {
    const ctx = buildContext('test-plugin', {});
    assert.strictEqual(ctx.ai, ai, 'ctx.ai must be the same instance the host uses');
    assert.equal(typeof ctx.ai.invoke, 'function', 'ctx.ai must expose invoke()');
  });

  it('provides ctx.LLM matching the host LLM constant', () => {
    const ctx = buildContext('test-plugin', {});
    assert.strictEqual(ctx.LLM, LLM, 'ctx.LLM must match the host LLM constant');
    assert.equal(typeof ctx.LLM, 'string', 'ctx.LLM must be a string model identifier');
  });
});
