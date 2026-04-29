import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { invokeOnActivate, invokeOnDeactivate, invokeOnUninstall } from '../../../src/lib/plugins/lifecycle.js';
import { logger } from '../../../src/lib/logger.js';

const origErr = console.error;
const origWarn = console.warn;
console.error = () => {};
console.warn = () => {};

describe('lifecycle', () => {
  beforeEach(() => logger._reset());

  it('invokes onActivate when present', async () => {
    let called = 0;
    await invokeOnActivate({ onActivate: () => { called++; } }, { pluginId: 'x' });
    assert.equal(called, 1);
  });

  it('is a no-op when onActivate is missing', async () => {
    await invokeOnActivate({}, { pluginId: 'x' });
    await invokeOnActivate(null, { pluginId: 'x' });
    assert.ok(true, 'no throw');
  });

  it('catches and logs errors from onActivate', async () => {
    await invokeOnActivate({
      onActivate: () => { throw new Error('boom'); },
    }, { pluginId: 'x' });
    const entries = logger.recent({ level: 'error' });
    assert.ok(entries.some((e) => e.code === 'plugin_on_activate_failed'));
  });

  it('catches and logs errors from onDeactivate', async () => {
    await invokeOnDeactivate({
      onDeactivate: () => { throw new Error('bad'); },
    }, { pluginId: 'y' });
    const entries = logger.recent({ level: 'error' });
    assert.ok(entries.some((e) => e.code === 'plugin_on_deactivate_failed'));
  });

  it('invokes onUninstall when present', async () => {
    let called = 0;
    await invokeOnUninstall({ onUninstall: () => { called++; } }, { pluginId: 'z' });
    assert.equal(called, 1);
  });

  it('is a no-op when onUninstall is missing', async () => {
    await invokeOnUninstall({}, { pluginId: 'z' });
    await invokeOnUninstall(null, { pluginId: 'z' });
    assert.ok(true, 'no throw');
  });

  it('PROPAGATES errors from onUninstall (unlike activate/deactivate)', async () => {
    await assert.rejects(
      () => invokeOnUninstall({ onUninstall: () => { throw new Error('boom'); } }, { pluginId: 'z' }),
      /boom/,
    );
  });
});

process.on('exit', () => { console.error = origErr; console.warn = origWarn; });
