import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../../../src/lib/plugins/manifest.js';

const baseManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  apiVersion: '1.x',
  description: 'A demo plugin.',
  capabilities: [],
  extensionPoints: {},
};

function assertMissingCapability(manifest, capability) {
  const result = validateManifest(manifest, { expectedId: manifest.id });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes(`extensionPoints declare capabilities not listed in "capabilities": ${capability}`)),
    result.errors.join('\n'),
  );
}

describe('plugin registry extension-point capability gates', () => {
  it('requires learnerCompletionAfter capability before a manifest can use the slot', () => {
    assertMissingCapability({
      ...baseManifest,
      extensionPoints: {
        slots: { learnerCompletionAfter: 'client/Completion.jsx' },
      },
    }, 'ui.slot.learnerCompletionAfter');
  });

  it('requires targeted secret-event receive capability before a manifest can receive the event', () => {
    assertMissingCapability({
      ...baseManifest,
      extensionPoints: {
        secretEvents: [{ event: 'openrouter-rewards.keyAwarded' }],
      },
    }, 'secretEvent.receive.openrouter-rewards.keyAwarded');
  });

  it('accepts the PR 144 host surfaces when their capabilities are declared', () => {
    const result = validateManifest({
      ...baseManifest,
      capabilities: [
        'ui.slot.adminProfileFields',
        'ui.slot.learnerProfileFields',
        'ui.slot.learnerHomeBanner',
        'ui.slot.learnerCompletionAfter',
        'secretEvent.receive.openrouter-rewards.keyAwarded',
        'user.metadata.read',
        'user.metadata.write',
      ],
      extensionPoints: {
        slots: {
          adminProfileFields: 'client/AdminProfileFields.jsx',
          learnerProfileFields: 'client/LearnerProfileFields.jsx',
          learnerHomeBanner: 'client/LearnerHomeBanner.jsx',
          learnerCompletionAfter: 'client/LearnerCompletionAfter.jsx',
        },
        secretEvents: [{ event: 'openrouter-rewards.keyAwarded' }],
      },
    }, { expectedId: 'demo' });

    assert.equal(result.ok, true, result.errors?.join('\n'));
  });
});
