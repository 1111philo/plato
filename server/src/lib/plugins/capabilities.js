/**
 * Plugin capability vocabulary.
 *
 * Every extension point a plugin uses requires a declared capability in
 * manifest.capabilities. Missing declarations fail registration with
 * `plugin_capability_missing`. Surfaced to admins at activation so they
 * see what enabling a plugin authorizes.
 *
 * Stays in sync with:
 *   - docs/plugins/plugin.schema.json (capability enum)
 *   - packages/plugin-sdk/index.d.ts (Capability type)
 *   - docs/plugins/CAPABILITIES.md (human reference)
 */

/** Concrete (non-pattern) capabilities. */
export const STATIC_CAPABILITIES = Object.freeze([
  'server.routes',
  'settings.read',
  'settings.write',
  'ui.adminNav',
  'user.metadata.read',
  'user.metadata.write',
  'kpi',
  'agent',
  'syncData.namespace',
]);

/** Pattern capabilities — `ui.slot.<slotName>` and `hook.<hookName>`. */
const PATTERN_CAPABILITIES = [
  /^ui\.slot\.[a-zA-Z][a-zA-Z0-9]*$/,
  /^hook\.[a-zA-Z][a-zA-Z0-9]*$/,
];

/** True iff `cap` is a recognized capability string. */
export function isValidCapability(cap) {
  if (typeof cap !== 'string') return false;
  if (STATIC_CAPABILITIES.includes(cap)) return true;
  return PATTERN_CAPABILITIES.some((re) => re.test(cap));
}

/**
 * Compute the set of capabilities a manifest's extensionPoints actually require.
 * The registry compares this against the declared `capabilities` list and fails
 * registration if anything is missing.
 */
export function requiredCapabilities(manifest) {
  const required = new Set();
  const ep = manifest.extensionPoints || {};

  if (ep.serverRoutes) required.add('server.routes');
  if (ep.slots) {
    for (const slot of Object.keys(ep.slots)) required.add(`ui.slot.${slot}`);
  }
  if (Array.isArray(ep.hooks)) {
    for (const hook of ep.hooks) required.add(`hook.${hook}`);
  }
  if (ep.syncDataNamespace) required.add('syncData.namespace');

  // settingsSchema implies settings read/write
  if (manifest.settingsSchema) {
    required.add('settings.read');
    required.add('settings.write');
  }

  return [...required];
}

/**
 * Returns an array of missing capabilities (declared in extensionPoints but
 * not listed in manifest.capabilities). Empty array means OK.
 */
export function missingCapabilities(manifest) {
  const required = requiredCapabilities(manifest);
  const declared = new Set(manifest.capabilities || []);
  return required.filter((cap) => !declared.has(cap));
}
