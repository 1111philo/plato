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
export { default as db } from '../db.js';

export { authenticate } from '../../middleware/authenticate.js';
export { requireAdmin } from '../../middleware/requireAdmin.js';

export { generateInviteToken } from '../crypto.js';

export { APP_URL } from '../../config.js';

export { logger as hostLogger } from '../logger.js';

// Re-export third-party packages built-in plugins depend on. Third-party plugins
// SHOULD declare their own dependencies and not import from this file unless the
// dependency is genuinely shared with the host (Hono is the canonical example).
// Built-in plugins shipped with plato can rely on whatever's in server/package.json.
export { WebClient } from '@slack/web-api';
