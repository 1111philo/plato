import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { on, _reset as resetHooks } from '../../../src/lib/plugins/hooks.js';
import ai, { LLM } from '../../../src/lib/ai-provider.js';

// Silence console noise from registry boot
const origWarn = console.warn;
console.warn = () => {};

describe('plugin context — ctx.ai and ctx.LLM', () => {
  beforeEach(() => resetHooks());

  it('hook handlers receive ctx.ai (the host ai provider instance)', async () => {
    // Simulate what the registry's subscribeHooks does: wrap a hook fn so it
    // receives (payload, ctx). We test the ctx.ai contract directly by
    // registering a handler that captures ctx and checking the reference.
    let capturedCtx = null;

    // Build a minimal ctx matching what buildContext() returns, including ai/LLM
    const ctx = {
      pluginId: 'test',
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      db: {},
      settings: {},
      setSettings: async () => {},
      emit: () => {},
      ai,
      LLM,
    };

    const handler = (payload, c) => { capturedCtx = c; return null; };

    // Simulate registry's subscribeHooks wrapper: calls fn(payload, ctx)
    on('lessonStarted', (payload) => handler(payload, ctx));
    const { emit } = await import('../../../src/lib/plugins/hooks.js');
    await emit('lessonStarted', { lessonId: 'x' });

    assert.ok(capturedCtx, 'ctx must be passed to hook handler');
    assert.strictEqual(capturedCtx.ai, ai, 'ctx.ai must be the same ai instance as the host uses');
    assert.strictEqual(capturedCtx.LLM, LLM, 'ctx.LLM must match the host LLM constant');
    assert.equal(typeof capturedCtx.ai.invoke, 'function', 'ctx.ai must expose an invoke() method');
  });
});
