/**
 * Plugin route dispatchers.
 *
 * The catch-all is the only route the host registers for plugin paths — Hono
 * doesn't allow mid-request `server.route()` calls (throws "Can not add a route
 * since the matcher is already built"), so we can't dynamically mount each
 * plugin's router after boot. Instead, this single static handler dispatches
 * via `entry.serverModule.routes.fetch()` at request time.
 *
 * Same reason both /v1/plugins/<id>/* and /v1/admin/slack/* (legacy compat)
 * are dispatched through here rather than registered as plugin sub-routes.
 *
 * Order matters: the host MUST register the catch-all BEFORE `app.js` because
 * app.js has a global `app.get('*')` SPA fallback that would otherwise swallow
 * plugin GETs and return notFound.
 */

/**
 * Catch-all handler for `/v1/plugins/:pluginId/*`. Strips the prefix, dispatches
 * to the plugin's own Hono router via fetch(). The plugin's router applies its
 * own auth middleware.
 */
export function makePluginDispatcher(registry) {
  return async (c) => {
    const pluginId = c.req.param('pluginId');
    const entry = registry.get(pluginId);
    if (!entry) return c.json({ error: 'Plugin not installed' }, 404);
    if (!entry.enabled) return c.json({ error: 'Plugin disabled' }, 404);
    if (!entry.serverModule?.routes) return c.json({ error: 'Plugin has no server routes' }, 404);
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(`/v1/plugins/${pluginId}`, '') || '/';
    return entry.serverModule.routes.fetch(new Request(url.toString(), c.req.raw));
  };
}

/**
 * Backwards-compat shim for the legacy `/v1/admin/slack/*` endpoints. Before
 * the plugin system Slack lived at `/v1/admin/slack/*`; now it's at
 * `/v1/plugins/slack/admin/*`. This shim re-dispatches old paths to the plugin
 * so stale browser tabs during deploy keep working. Drop in the next major.
 */
export function makeSlackLegacyShim(registry) {
  return async (c) => {
    const entry = registry.get('slack');
    if (!entry?.enabled || !entry.serverModule?.routes) {
      return c.json({ error: 'Slack integration not available' }, 404);
    }
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace('/v1/admin/slack', '/admin');
    return entry.serverModule.routes.fetch(new Request(url.toString(), c.req.raw));
  };
}
