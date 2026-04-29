/**
 * Template: minimal Hono router for a plato plugin.
 *
 * Copy into plugins/<id>/server/index.js. Replace {{id}} with your plugin id.
 *
 * Manifest must include:
 *   "capabilities": ["server.routes", ...],
 *   "extensionPoints": { "serverRoutes": "server/index.js#default" }
 */

import { Hono, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';

const routes = new Hono();

// All admin routes require auth + admin. The plugin host adds its own
// enabled-gate; this middleware adds authn/authz.
routes.use('*', authenticate, requireAdmin);

routes.get('/admin/hello', (c) => c.json({ ok: true, plugin: '{{id}}' }));

export default {
  routes,
  /**
   * Called once when admin enables the plugin AND once at boot if already enabled.
   * Idempotent. Use for migrations, cache warmup. Don't run heavy work here.
   */
  async onActivate(ctx) {
    ctx.logger.info('activated');
  },
  /**
   * Called when admin disables the plugin. Should release resources, NOT delete
   * user data. Settings are preserved across disable/enable cycles.
   */
  async onDeactivate(ctx) {
    ctx.logger.info('deactivated');
  },
  /**
   * Called only when an admin uses "Delete plugin data" on /plato/plugins.
   * Plugin must already be disabled; admin must type the plugin id to confirm.
   * Wipe everything the plugin has stored. Errors propagate — surface partial-
   * cleanup failures rather than swallow them. Remove this method if your
   * plugin stores nothing.
   */
  async onUninstall(ctx) {
    ctx.logger.info('uninstall_data_start');
    // TODO: iterate users + deleteUserMeta, clear plugin sync-data namespace, etc.
    ctx.logger.info('uninstall_data_done');
  },
};
