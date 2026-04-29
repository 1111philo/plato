/**
 * Server-side plugin SDK — re-exports the host dependencies plugins commonly need.
 *
 * Plugins live outside server/ and don't have their own node_modules. Importing
 * bare modules like `hono` from a plugin file would fail (Node walks up from the
 * plugin directory and finds nothing). Instead, plugins import from this file
 * via a relative path:
 *
 *   import { Hono, db, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';
 *
 * This file lives inside server/ where node_modules is available, so its bare
 * imports resolve cleanly. Plugins get a single, stable surface to import from.
 *
 * Add to this file when a plugin extension point genuinely needs a new host
 * primitive. Don't expose the entire `db` module — explicitly re-export the
 * subset plugins are allowed to use.
 */

export { Hono } from 'hono';

// Phase 1 exposes the full db module. Plugins are trusted/audited (no admin upload),
// so this is acceptable for v1. Phase 2+ may narrow this to the `PluginDbView`
// surface declared in packages/plugin-sdk/index.d.ts (see CAPABILITIES.md). Don't
// add new core methods that bypass plugin contracts here — extend the registry instead.
import dbDefault from '../db.js';
export { default as db } from '../db.js';

/**
 * Per-user plugin metadata storage. Reads/writes a single sync-data record at
 * `userMeta:<pluginId>` on the given user. The HTTP `/v1/sync` API filters
 * `userMeta:*` keys out of bulk responses and rejects them on single-key
 * read/write — so this surface is server-side-only by default. Plugins that
 * need learner-visible per-user data should expose their own routes.
 *
 * Capability: `user.metadata.read` / `user.metadata.write` (declarative; not
 * enforced at runtime — same trust model as `server.routes`. Phase 3+
 * sandboxing would enforce.)
 */
export async function getUserMeta(userId, pluginId) {
  if (!userId || !pluginId) throw new Error('userId and pluginId required');
  const item = await dbDefault.getSyncData(userId, `userMeta:${pluginId}`);
  return item?.data || null;
}

export async function putUserMeta(userId, pluginId, data) {
  if (!userId || !pluginId) throw new Error('userId and pluginId required');
  if (!data || typeof data !== 'object') throw new Error('data must be an object');
  const existing = await dbDefault.getSyncData(userId, `userMeta:${pluginId}`);
  return dbDefault.putSyncData(userId, `userMeta:${pluginId}`, data, existing?.version || 0);
}

export async function deleteUserMeta(userId, pluginId) {
  if (!userId || !pluginId) throw new Error('userId and pluginId required');
  return dbDefault.deleteSyncData(userId, `userMeta:${pluginId}`);
}

export { authenticate } from '../../middleware/authenticate.js';
export { requireAdmin } from '../../middleware/requireAdmin.js';

export { generateInviteToken } from '../crypto.js';

export { APP_URL } from '../../config.js';

export { logger as hostLogger } from '../logger.js';

// Re-export third-party packages plugins shipped in this repo depend on. External
// plugins SHOULD declare their own dependencies and not import from this file
// unless the dependency is genuinely shared with the host (Hono is the canonical
// example). Plugins shipped in this repo can rely on whatever's in server/package.json.
export { WebClient } from '@slack/web-api';
