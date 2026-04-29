#!/usr/bin/env node
/**
 * Scaffold a new plato plugin.
 *
 * Usage:
 *   node scripts/create-plato-plugin.js <plugin-id> [--name "Display Name"]
 *
 * Creates plugins/<plugin-id>/ with a valid manifest, a minimal server router,
 * a settings panel slot, and a CLAUDE.md template. The plugin will pass
 * validate-plugins.js immediately and load on the next dev-server boot.
 *
 * AI agents should run this before generating any plugin code — it guarantees
 * the manifest is valid and gives a known-good starting point.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const args = process.argv.slice(2);
const id = args[0];
if (!id) {
  console.error('Usage: node scripts/create-plato-plugin.js <plugin-id> [--name "Display Name"]');
  process.exit(2);
}
if (!/^[a-z][a-z0-9-]{1,49}$/.test(id)) {
  console.error(`Plugin id "${id}" must be lower-case kebab (start with a letter, only [a-z0-9-], 2-50 chars).`);
  process.exit(2);
}

const nameIdx = args.indexOf('--name');
const displayName = nameIdx >= 0 ? args[nameIdx + 1] : id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

const targetDir = join(repoRoot, 'plugins', id);
if (existsSync(targetDir)) {
  console.error(`plugins/${id}/ already exists. Choose a different id or remove the directory first.`);
  process.exit(2);
}

mkdirSync(join(targetDir, 'server'), { recursive: true });
mkdirSync(join(targetDir, 'client'), { recursive: true });

// Read templates and substitute {{id}} / {{name}}
const templatesDir = join(repoRoot, 'docs', 'plugins', 'templates');

function loadTemplate(name) {
  const path = join(templatesDir, name);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

function fill(template, vars) {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, v),
    template,
  );
}

const vars = { id, name: displayName };

const manifest = {
  $schema: '../../docs/plugins/plugin.schema.json',
  id,
  name: displayName,
  version: '0.1.0',
  apiVersion: '1.x',
  description: `${displayName} plugin for plato.`,
  author: '',
  license: 'MIT',
  defaultEnabled: false,
  capabilities: [
    'server.routes',
    'settings.read',
    'settings.write',
    'ui.slot.adminSettingsPanel',
  ],
  extensionPoints: {
    serverRoutes: 'server/index.js#default',
    slots: { adminSettingsPanel: 'client/SettingsPanel.jsx' },
  },
  settingsSchema: {
    type: 'object',
    properties: {
      enabled_feature: { type: 'boolean', default: false, description: 'Example boolean setting.' },
    },
  },
};

const serverIndexTemplate = loadTemplate('server-route.js')
  || `import { Hono, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

routes.get('/admin/hello', (c) => c.json({ ok: true, plugin: '{{id}}' }));

export default {
  routes,
  async onActivate(ctx) { ctx.logger.info('activated'); },
  async onDeactivate(ctx) { ctx.logger.info('deactivated'); },
};
`;

const settingsPanelTemplate = loadTemplate('settings-panel.jsx')
  || `import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function SettingsPanel({ settings, onSave }) {
  const [draft, setDraft] = useState({ ...(settings || {}) });
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!draft.enabled_feature}
          onChange={(e) => setDraft((d) => ({ ...d, enabled_feature: e.target.checked }))}
        />
        <Label>Enabled feature</Label>
      </label>
      <Button
        onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
`;

const clientIndexContent = `import SettingsPanel from './SettingsPanel.jsx';

export default {
  slots: {
    adminSettingsPanel: SettingsPanel,
  },
};
`;

const claudeMdContent = `# plugins/${id}/ — Claude / agent instructions

Plugin: ${displayName} (${id}).

## Local invariants
- Settings live at \`_system:plugins:activation.${id}.settings\`.
- All admin routes are mounted under \`/v1/plugins/${id}/admin/*\`.
- This plugin must declare every capability it uses; the registry refuses to load
  a plugin that exercises an extension point without the matching capability.

## Adding new functionality
1. Pick the extension point from \`docs/plugins/EXTENSION_REFERENCE.md\` (or the
   \`GET /v1/plugins/extension-points\` endpoint).
2. Add the matching capability to \`plugin.json\`.
3. Wire the implementation in \`server/index.js\` or \`client/index.js\`.
4. Run \`node scripts/validate-plugins.js\` before committing.

## Don't
- Don't import core modules outside the SDK (\`server/src/lib/plugins/sdk.js\`)
  unless you've added a re-export there first.
- Don't write to other plugins' settings or to \`_system:settings.*\`.
- Don't override completion semantics or introduce hard lesson cutoffs.
`;

writeFileSync(join(targetDir, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(targetDir, 'server', 'index.js'), fill(serverIndexTemplate, vars));
writeFileSync(join(targetDir, 'client', 'SettingsPanel.jsx'), fill(settingsPanelTemplate, vars));
writeFileSync(join(targetDir, 'client', 'index.js'), clientIndexContent);
writeFileSync(join(targetDir, 'CLAUDE.md'), claudeMdContent);

console.log(`✓ Created plugins/${id}/`);
console.log(`  - plugin.json`);
console.log(`  - server/index.js`);
console.log(`  - client/SettingsPanel.jsx`);
console.log(`  - client/index.js`);
console.log(`  - CLAUDE.md`);
console.log('');
console.log('Next:');
console.log(`  1. Run "node scripts/validate-plugins.js" to confirm the manifest is valid.`);
console.log(`  2. Run "node server/dev-sqlite.js" — your plugin loads as defaultEnabled: false.`);
console.log(`  3. Open /plato/plugins and toggle the plugin on.`);
