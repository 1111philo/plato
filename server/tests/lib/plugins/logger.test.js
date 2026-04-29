import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPluginLogger } from '../../../src/lib/plugins/logger.js';
import { logger as hostLogger } from '../../../src/lib/logger.js';

const origErr = console.error;
const origWarn = console.warn;
const origLog = console.log;
console.error = () => {};
console.warn = () => {};

describe('createPluginLogger', () => {
  beforeEach(() => hostLogger._reset());

  it('prefixes warn codes with plugin.<id>.', () => {
    const log = createPluginLogger('slack');
    log.warn('connection_failed', { reason: 'timeout' });
    const entries = hostLogger.recent();
    const entry = entries.find((e) => e.code === 'plugin_slack_connection_failed');
    assert.ok(entry, 'expected plugin-prefixed code in buffer');
    assert.equal(entry.meta.reason, 'timeout');
  });

  it('prefixes error codes with plugin.<id>.', () => {
    const log = createPluginLogger('slack');
    log.error('boot_error', { reason: 'no token' });
    const entries = hostLogger.recent({ level: 'error' });
    assert.ok(entries.some((e) => e.code === 'plugin_slack_boot_error'));
  });

  it('info goes to stdout only, not the ring buffer', () => {
    let captured = null;
    console.log = (msg) => { captured = msg; };
    const log = createPluginLogger('slack');
    log.info('activated', { count: 1 });
    assert.match(captured || '', /plugin_slack_activated/);
    const entries = hostLogger.recent();
    assert.ok(!entries.some((e) => e.code === 'plugin_slack_activated'));
    console.log = origLog;
  });

  it('throws when constructed without a pluginId', () => {
    assert.throws(() => createPluginLogger(''), /pluginId/);
    assert.throws(() => createPluginLogger(null), /pluginId/);
  });
});

process.on('exit', () => { console.error = origErr; console.warn = origWarn; console.log = origLog; });
