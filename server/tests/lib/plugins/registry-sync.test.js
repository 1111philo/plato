/**
 * Each Lambda container keeps its own copy of plugin on/off and settings.
 * pluginRegistry.sync() re-reads the stored record, so a save made through
 * one container shows on the others, and a toggle or save from a container
 * with an old copy never writes that old copy back.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import db from '../../../src/lib/db.js';
import { pluginRegistry } from '../../../src/lib/plugins/registry.js';

const origWarn = console.warn;
const origLog = console.log;

function entry(settings = {}, enabled = true) {
  return {
    manifest: { id: 'slack', name: 'slack', version: '1.0.0', capabilities: [], extensionPoints: {} },
    dir: '/fake/slack', serverModule: null, enabled, settings, hasStoredState: true, loadError: null, hookUnsubs: [],
  };
}

describe('plugin registry sync across containers', () => {
  let stored; let realGet; let realPut;
  beforeEach(() => {
    console.warn = () => {}; console.log = () => {};
    realGet = db.getSyncData; realPut = db.putSyncData;
    stored = { version: 1, data: { slack: { enabled: true, settings: { botToken: 'xoxb', connected: true } } } };
    db.getSyncData = async (u, k) => (u === '_system' && k === 'plugins:activation' ? structuredClone(stored) : null);
    db.putSyncData = async (_u, _k, data, version) => {
      if (version !== stored.version) throw new Error('version conflict');
      stored = { version: version + 1, data: structuredClone(data) };
    };
    // This container booted before the admin's save.
    pluginRegistry._load({ slack: entry({ botToken: 'xoxb', connected: true }) });
  });
  afterEach(() => {
    db.getSyncData = realGet; db.putSyncData = realPut;
    pluginRegistry._reset();
    console.warn = origWarn; console.log = origLog;
  });

  // Another container saves the auto-invite channel.
  const saveElsewhere = () => {
    stored = { version: stored.version + 1, data: { slack: { enabled: true, settings: { botToken: 'xoxb', connected: true, autoInviteEnabled: true, autoInviteChannelId: 'C1' } } } };
  };

  it('picks up settings saved through another container', async () => {
    saveElsewhere();
    assert.equal(pluginRegistry.get('slack').settings.autoInviteChannelId, undefined);
    await pluginRegistry.sync();
    assert.equal(pluginRegistry.get('slack').settings.autoInviteChannelId, 'C1');
  });

  it('a throttled sync waits out its window', async () => {
    saveElsewhere();
    await pluginRegistry.sync({ maxAgeMs: 60_000 });
    assert.equal(pluginRegistry.get('slack').settings.autoInviteChannelId, undefined, 'synced moments ago at load');
    await pluginRegistry.sync({ maxAgeMs: 0 });
    assert.equal(pluginRegistry.get('slack').settings.autoInviteChannelId, 'C1');
  });

  it('turning a plugin off from an old copy keeps the stored settings', async () => {
    saveElsewhere();
    await pluginRegistry.setEnabled('slack', false);
    assert.equal(stored.data.slack.enabled, false);
    assert.equal(stored.data.slack.settings.autoInviteChannelId, 'C1');
  });

  it('a settings save from an old copy keeps the stored on/off', async () => {
    stored.data.slack.enabled = false; // turned off elsewhere
    await pluginRegistry.updateSettings('slack', { botToken: 'xoxb', connected: true, autoInviteEnabled: true });
    assert.equal(stored.data.slack.enabled, false);
    assert.equal(pluginRegistry.get('slack').enabled, false);
  });

  it('follows on/off changed elsewhere, and a failed read keeps the current state', async () => {
    stored.data.slack.enabled = false;
    await pluginRegistry.sync();
    assert.equal(pluginRegistry.get('slack').enabled, false);
    db.getSyncData = async () => { throw new Error('throttled'); };
    await pluginRegistry.sync();
    assert.equal(pluginRegistry.get('slack').enabled, false);
    assert.equal(pluginRegistry.get('slack').settings.botToken, 'xoxb');
  });
});
