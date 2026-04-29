/**
 * Plugin lifecycle: invoke onActivate / onDeactivate from a plugin's server export.
 *
 * Both are optional. Both are idempotent in the contract — a plugin's onActivate
 * must tolerate being called twice (e.g. once at boot and once when admin re-enables).
 *
 * Errors are logged but do not propagate; a misbehaving plugin should not crash boot.
 */

import { logger } from '../logger.js';

export async function invokeOnActivate(plugin, ctx) {
  if (!plugin || typeof plugin.onActivate !== 'function') return;
  try {
    await plugin.onActivate(ctx);
  } catch (err) {
    logger.error('plugin_on_activate_failed', {
      pluginId: ctx.pluginId,
      error: err?.message || String(err),
      stack: err?.stack,
    });
  }
}

export async function invokeOnDeactivate(plugin, ctx) {
  if (!plugin || typeof plugin.onDeactivate !== 'function') return;
  try {
    await plugin.onDeactivate(ctx);
  } catch (err) {
    logger.error('plugin_on_deactivate_failed', {
      pluginId: ctx.pluginId,
      error: err?.message || String(err),
      stack: err?.stack,
    });
  }
}
