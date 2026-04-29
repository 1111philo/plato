import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidCapability,
  requiredCapabilities,
  missingCapabilities,
  STATIC_CAPABILITIES,
} from '../../../src/lib/plugins/capabilities.js';

describe('capabilities', () => {
  it('recognizes static capabilities', () => {
    for (const cap of STATIC_CAPABILITIES) {
      assert.equal(isValidCapability(cap), true, `should accept ${cap}`);
    }
  });

  it('recognizes pattern capabilities', () => {
    assert.equal(isValidCapability('ui.slot.adminSettingsPanel'), true);
    assert.equal(isValidCapability('hook.userCreated'), true);
  });

  it('rejects unknown capabilities', () => {
    assert.equal(isValidCapability('totally.fake'), false);
    assert.equal(isValidCapability(''), false);
    assert.equal(isValidCapability(123), false);
  });

  it('computes required capabilities from extension points', () => {
    const manifest = {
      capabilities: [],
      extensionPoints: {
        serverRoutes: 'server/index.js#default',
        slots: { adminSettingsPanel: 'client/X.jsx', adminUserRowAction: 'client/Y.jsx' },
        hooks: ['userCreated'],
      },
      settingsSchema: { type: 'object', properties: {} },
    };
    const required = requiredCapabilities(manifest).sort();
    assert.deepEqual(required, [
      'hook.userCreated',
      'server.routes',
      'settings.read',
      'settings.write',
      'ui.slot.adminSettingsPanel',
      'ui.slot.adminUserRowAction',
    ]);
  });

  it('reports missing capabilities', () => {
    const manifest = {
      capabilities: ['server.routes'],
      extensionPoints: {
        serverRoutes: 'server/index.js#default',
        slots: { adminSettingsPanel: 'client/X.jsx' },
      },
    };
    const missing = missingCapabilities(manifest);
    assert.ok(missing.includes('ui.slot.adminSettingsPanel'));
    assert.ok(!missing.includes('server.routes'));
  });
});
