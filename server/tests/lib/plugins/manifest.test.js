import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../../../src/lib/plugins/manifest.js';

const valid = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  apiVersion: '1.x',
  description: 'A demo plugin.',
  capabilities: ['server.routes'],
  extensionPoints: { serverRoutes: 'server/index.js#default' },
};

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const r = validateManifest(valid, { expectedId: 'demo' });
    assert.equal(r.ok, true);
  });

  it('rejects missing required fields', () => {
    const { id: _id, ...withoutId } = valid;
    const r = validateManifest(withoutId, { expectedId: 'demo' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('missing required field: id')));
  });

  it('rejects mismatched directory id', () => {
    const r = validateManifest(valid, { expectedId: 'other' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('does not match directory name')));
  });

  it('rejects unknown capability', () => {
    const m = { ...valid, capabilities: ['totally.fake'] };
    const r = validateManifest(m, { expectedId: 'demo' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('unknown capability')));
  });

  it('rejects extension points without declared capabilities', () => {
    const m = {
      ...valid,
      capabilities: ['server.routes'], // missing ui.slot.adminSettingsPanel
      extensionPoints: {
        serverRoutes: 'server/index.js#default',
        slots: { adminSettingsPanel: 'client/Panel.jsx' },
      },
    };
    const r = validateManifest(m, { expectedId: 'demo' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('extensionPoints declare capabilities not listed')));
  });

  it('rejects unknown slot name', () => {
    const m = {
      ...valid,
      capabilities: ['ui.slot.fakeSlot'],
      extensionPoints: { slots: { fakeSlot: 'client/X.jsx' } },
    };
    const r = validateManifest(m, { expectedId: 'demo' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('unknown slot name')));
  });

  it('rejects bad serverRoutes ref', () => {
    const m = { ...valid, extensionPoints: { serverRoutes: 'noprefix.js' } };
    const r = validateManifest(m, { expectedId: 'demo' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('serverRoutes')));
  });

  it('rejects malformed plugin id', () => {
    const m = { ...valid, id: 'BadID' };
    const r = validateManifest(m, { expectedId: 'BadID' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('id "BadID"')));
  });

  it('rejects bad version', () => {
    const m = { ...valid, version: 'not-semver' };
    const r = validateManifest(m, { expectedId: 'demo' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('version')));
  });
});
