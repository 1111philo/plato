#!/usr/bin/env node
/**
 * Validate every plugin manifest in plugins/<id>/plugin.json against the JSON
 * Schema at docs/plugins/plugin.schema.json AND the host's capability table.
 *
 * Run locally: `node scripts/validate-plugins.js`
 * In CI: same — exits non-zero on any failure.
 *
 * Hand-rolled validator (no JSON-Schema runtime dep) to avoid pulling a package
 * just for CI. Logic mirrors server/src/lib/plugins/manifest.js.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../server/src/lib/plugins/manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const pluginsDir = join(repoRoot, 'plugins');

if (!existsSync(pluginsDir)) {
  console.log('No plugins/ directory; nothing to validate.');
  process.exit(0);
}

const failures = [];
const successes = [];

for (const entry of readdirSync(pluginsDir)) {
  const dir = join(pluginsDir, entry);
  let s;
  try { s = statSync(dir); } catch { continue; }
  if (!s.isDirectory()) continue;

  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    failures.push({ id: entry, errors: ['plugin.json missing'] });
    continue;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    failures.push({ id: entry, errors: [`plugin.json parse error: ${err.message}`] });
    continue;
  }

  const result = validateManifest(raw, { expectedId: entry });
  if (!result.ok) {
    failures.push({ id: entry, errors: result.errors });
    continue;
  }

  // Verify referenced files exist on disk.
  const fileChecks = [];
  if (raw.extensionPoints?.serverRoutes) {
    const file = raw.extensionPoints.serverRoutes.split('#')[0];
    if (!existsSync(join(dir, file))) fileChecks.push(`serverRoutes file missing: ${file}`);
  }
  for (const [slot, file] of Object.entries(raw.extensionPoints?.slots || {})) {
    if (!existsSync(join(dir, file))) fileChecks.push(`slot "${slot}" file missing: ${file}`);
  }
  if (fileChecks.length) {
    failures.push({ id: entry, errors: fileChecks });
    continue;
  }

  successes.push(entry);
}

if (successes.length) {
  console.log(`✓ Valid plugins: ${successes.join(', ')}`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} plugin(s) failed validation:`);
  for (const f of failures) {
    console.error(`  - ${f.id}:`);
    for (const err of f.errors) console.error(`      ${err}`);
  }
  process.exit(1);
}
