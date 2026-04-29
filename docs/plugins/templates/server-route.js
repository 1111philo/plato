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
};
