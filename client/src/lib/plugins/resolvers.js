/**
 * Pure module-shape resolvers for plugin client exports. Kept in a separate file
 * from registry.js so unit tests can import them in plain Node without pulling
 * in loader.js (which uses Vite's `import.meta.glob`, undefined outside Vite).
 *
 * Plugins may export their client surface as either:
 *   export default { slots: { adminSettingsPanel: Panel } }   ← canonical
 *   export const slots = { adminSettingsPanel: Panel }        ← namespace
 * Both shapes are accepted.
 */

/** Component for `slotName`, or null if the plugin doesn't register one. */
export function resolveSlotComponent(mod, slotName) {
  return mod?.default?.slots?.[slotName] || mod?.slots?.[slotName] || null;
}

/**
 * Settings panel for the admin Integrations card. Resolution order:
 *   1. slots.adminSettingsPanel — canonical, matches every other slot
 *   2. settingsPanel            — convenience top-level export (back-compat)
 *
 * The Slack plugin uses (1). The fallback (2) keeps older plugin shapes working
 * if any exist.
 */
export function resolveSettingsPanel(mod) {
  return resolveSlotComponent(mod, 'adminSettingsPanel')
      || mod?.default?.settingsPanel
      || mod?.settingsPanel
      || null;
}
