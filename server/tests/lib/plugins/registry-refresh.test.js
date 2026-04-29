/**
 * Coverage for the cross-Lambda staleness fix:
 *   - refreshActivation reconciles a stale in-memory entry with the persisted
 *     activation record (the bug: warm container kept serving "Plugin disabled"
 *     after admin enabled the plugin from a different container).
 *   - updateSettings does not clobber a freshly-persisted enabled flag with a
 *     stale local entry.enabled when called from a different container.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import db from '../../../src/lib/db.js';
import { pluginRegistry } from '../../../src/lib/plugins/registry.js';

const ACTIVATION_KEY = 'plugins:activation';

function fakeSystemSyncStore() {
  const store = new Map();
  const k = (u, key) => `${u}\0${key}`;
  return {
    getSyncData: async (u, key) => store.get(k(u, key)) || null,
    putSyncData: async (u, key, data, expectedVersion) => {
      const cur = store.get(k(u, key));
      const ver = cur?.version || 0;
      if (expectedVersion && expectedVersion !== ver) {
        const err = new Error('conflict'); err.name = 'ConditionalCheckFailedException'; throw err;
      }
      const next = { data, version: ver + 1, updatedAt: new Date().toISOString() };
      store.set(k(u, key), next);
      return next;
    },
    /** Directly seed an activation record (simulates write from another Lambda). */
    seedActivation: (record) => {
      const cur = store.get(k('_system', ACTIVATION_KEY));
      const ver = cur?.version || 0;
      store.set(k('_system', ACTIVATION_KEY), { data: record, version: ver + 1 });
    },
  };
}

function makeEntry({ id = 'demo', enabled = false, manifest, serverModule, settings = {} } = {}) {
  return {
    manifest: manifest || { id, defaultEnabled: false },
    dir: `/tmp/plugins/${id}`,
    serverModule: serverModule || { routes: { fetch: async () => new Response('ok') } },
    enabled,
    settings,
    hasStoredState: false,
    loadError: null,
    hookUnsubs: [],
  };
}

describe('pluginRegistry.refreshActivation', () => {
  let store;
  let originalGet;
  let originalPut;

  beforeEach(() => {
    store = fakeSystemSyncStore();
    originalGet = db.getSyncData;
    originalPut = db.putSyncData;
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    pluginRegistry._reset();
  });

  afterEach(() => {
    db.getSyncData = originalGet;
    db.putSyncData = originalPut;
    pluginRegistry._reset();
  });

  it('flips a stale disabled entry to enabled when DB has enabled=true', async () => {
    let activated = 0;
    const entry = makeEntry({
      id: 'teacher-comments',
      enabled: false,
      serverModule: { onActivate: async () => { activated++; }, routes: {} },
    });
    pluginRegistry._setEntry('teacher-comments', entry);
    store.seedActivation({ 'teacher-comments': { enabled: true, settings: {} } });

    await pluginRegistry.refreshActivation('teacher-comments');

    assert.equal(entry.enabled, true);
    assert.equal(activated, 1, 'onActivate should run on the flip');
  });

  it('flips a stale enabled entry to disabled when DB has enabled=false', async () => {
    let deactivated = 0;
    const entry = makeEntry({
      id: 'demo',
      enabled: true,
      serverModule: { onDeactivate: async () => { deactivated++; }, routes: {} },
    });
    pluginRegistry._setEntry('demo', entry);
    store.seedActivation({ demo: { enabled: false, settings: {} } });

    await pluginRegistry.refreshActivation('demo');

    assert.equal(entry.enabled, false);
    assert.equal(deactivated, 1, 'onDeactivate should run on the flip');
  });

  it('is a no-op when DB state matches local state (does not re-fire onActivate)', async () => {
    let activated = 0;
    const entry = makeEntry({
      id: 'demo',
      enabled: true,
      serverModule: { onActivate: async () => { activated++; }, routes: {} },
    });
    pluginRegistry._setEntry('demo', entry);
    store.seedActivation({ demo: { enabled: true, settings: { foo: 'bar' } } });

    await pluginRegistry.refreshActivation('demo');

    assert.equal(entry.enabled, true);
    assert.equal(activated, 0, 'onActivate should not re-fire when state is unchanged');
    assert.deepEqual(entry.settings, { foo: 'bar' }, 'settings still get refreshed');
  });

  it('falls back to manifest.defaultEnabled when no record exists', async () => {
    const entry = makeEntry({
      id: 'demo',
      enabled: false,
      manifest: { id: 'demo', defaultEnabled: true },
      serverModule: { routes: {} },
    });
    pluginRegistry._setEntry('demo', entry);

    await pluginRegistry.refreshActivation('demo');

    assert.equal(entry.enabled, true);
  });

  it('is a safe no-op for unknown plugins, failed loads, and DB errors', async () => {
    // Unknown id
    await assert.doesNotReject(() => pluginRegistry.refreshActivation('nope'));
    // Failed-load entry
    pluginRegistry._setEntry('broken', { ...makeEntry({ id: 'broken' }), loadError: 'syntax' });
    await assert.doesNotReject(() => pluginRegistry.refreshActivation('broken'));
    // DB error
    pluginRegistry._setEntry('demo', makeEntry({ id: 'demo' }));
    db.getSyncData = async () => { throw new Error('boom'); };
    await assert.doesNotReject(() => pluginRegistry.refreshActivation('demo'));
  });
});

describe('pluginRegistry.updateSettings — stale-enabled write fix', () => {
  let store;
  let originalGet;
  let originalPut;

  beforeEach(() => {
    store = fakeSystemSyncStore();
    originalGet = db.getSyncData;
    originalPut = db.putSyncData;
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    pluginRegistry._reset();
  });

  afterEach(() => {
    db.getSyncData = originalGet;
    db.putSyncData = originalPut;
    pluginRegistry._reset();
  });

  it('does not clobber a DB-enabled flag from a stale (disabled) container', async () => {
    // Container A enabled the plugin and persisted enabled=true.
    store.seedActivation({ demo: { enabled: true, settings: { existing: 1 } } });
    // Container B's local entry is still stale (enabled=false).
    pluginRegistry._setEntry('demo', makeEntry({ id: 'demo', enabled: false }));

    await pluginRegistry.updateSettings('demo', { newKey: 'v' });

    const persisted = await db.getSyncData('_system', ACTIVATION_KEY);
    assert.equal(persisted.data.demo.enabled, true, 'persisted enabled must stay true');
    assert.deepEqual(persisted.data.demo.settings, { newKey: 'v' });

    const entry = pluginRegistry.get('demo');
    assert.equal(entry.enabled, true, 'local entry should also reconcile to true');
  });
});
