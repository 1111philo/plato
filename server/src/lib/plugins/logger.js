/**
 * Plugin-scoped logger. Codes are auto-prefixed with `plugin.<id>.` so log lines
 * are traceable to the source plugin in both the in-process buffer and CloudWatch.
 *
 * Mirrors the shape of server/src/lib/logger.js but adds an `info` convenience
 * that goes to stdout only (info doesn't pollute the error/warn ring-buffer the
 * pilot agent consumes).
 */

import { logger } from '../logger.js';

function prefix(pluginId, code) {
  // Codes are snake_case across the host (logger.js coerces non-alphanumeric to `_`).
  // We pre-format with `_` so the host doesn't have to coerce, and the resulting
  // code is searchable as `plugin_<id>_<code>` in CloudWatch and the pilot view.
  const safeId = String(pluginId).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (typeof code !== 'string' || !code) return `plugin_${safeId}_unknown`;
  return `plugin_${safeId}_${code}`;
}

export function createPluginLogger(pluginId) {
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error('createPluginLogger requires a pluginId');
  }
  return {
    info(code, meta) {
      // Stdout only — info is for lifecycle and dev-debug noise; we don't want
      // it competing with errors in the pilot agent's view.
      try {
        console.log(JSON.stringify({ level: 'info', code: prefix(pluginId, code), ...(meta || {}) }));
      } catch {
        console.log(`[plugin.${pluginId}.${code}]`);
      }
    },
    warn(code, meta) {
      logger.warn(prefix(pluginId, code), meta);
    },
    error(code, meta) {
      logger.error(prefix(pluginId, code), meta);
    },
  };
}
