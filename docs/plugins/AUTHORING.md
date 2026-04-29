# Authoring a plato plugin

A walkthrough for humans. (If you're an AI agent, start with [AGENTS.md](./AGENTS.md).)

## Mental model

Plato has a manifest-driven plugin system. Each plugin lives in `plugins/<id>/` with:

```
plugins/my-plugin/
  plugin.json              # manifest (capabilities, extension points, settings schema)
  server/
    index.js               # default-exports { routes, hooks, onActivate, onDeactivate, onUninstall }
  client/
    index.js               # default-exports { slots, settingsPanel, navItems }
    SettingsPanel.jsx      # (or any other slot components)
  CLAUDE.md                # per-plugin agent/contributor notes (optional but recommended)
```

The host discovers plugins at boot (`server/src/lib/plugins/registry.js`), validates their manifests against `docs/plugins/plugin.schema.json`, and:

- Mounts the plugin's Hono router under `/v1/plugins/<id>/`
- Registers slot components for rendering by `<PluginSlot name="...">`
- Calls `onActivate` once, plus once per enable toggle; `onDeactivate` on disable; `onUninstall` only when an admin uses "Delete plugin data" (plugin must be disabled + admin types id to confirm)
- Stores per-plugin settings in `_system:plugins:activation.<id>.settings`

Disabled plugins consume zero runtime surface — their routes return 404, their slots render nothing, their hooks don't fire.

## Step-by-step

### 1. Scaffold

```bash
node scripts/create-plato-plugin.js my-plugin --name "My Plugin"
```

This creates a working plugin with one settings field, a stub admin route, and a `CLAUDE.md`. It validates immediately.

### 2. Customize the manifest

Edit `plugins/my-plugin/plugin.json`:

- Add capabilities matching the extension points you actually use (see [CAPABILITIES.md](./CAPABILITIES.md))
- Update `description`
- Define your `settingsSchema` (or remove it if you don't have settings)
- Set `defaultEnabled: true` if it should be on by default for new installs

Validate:

```bash
node scripts/validate-plugins.js
```

### 3. Server side

Server-side code lives in `server/index.js` and exports a default object:

```js
import { Hono, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);
routes.get('/admin/items', (c) => c.json([]));

export default {
  routes,
  hooks: {
    // Optional: subscribe to defined core hooks (Phase 2+)
  },
  async onActivate(ctx) {
    ctx.logger.info('activated', { pluginId: ctx.pluginId });
  },
  async onDeactivate(ctx) {
    ctx.logger.info('deactivated');
  },
};
```

The plugin SDK at `server/src/lib/plugins/sdk.js` re-exports the host primitives plugins need (`Hono`, `db`, `authenticate`, `requireAdmin`, `generateInviteToken`, `APP_URL`). Adding new dependencies to the SDK is a core change.

Plugin routes are mounted under `/v1/plugins/<id>/`. So `routes.get('/admin/items')` becomes `GET /v1/plugins/<id>/admin/items`. Always include auth middleware — the host only gates on enabled state, not auth.

### 4. Client side

Client-side code lives in `client/index.js`:

```js
import SettingsPanel from './SettingsPanel.jsx';

export default {
  slots: {
    adminSettingsPanel: SettingsPanel,
  },
};
```

Slot components receive props per [EXTENSION_REFERENCE.md](./EXTENSION_REFERENCE.md). The `adminSettingsPanel` slot receives `{ pluginId, settings, onSave }`.

The `@/components/ui/...` and `@/lib/...` aliases work in plugin code (configured in `client/vite.config.js`).

### 5. Run it

```bash
node server/dev-sqlite.js
```

Plato discovers your plugin and logs `plugin_loaded`. Open `http://localhost:3000/plato/plugins`, find your card, toggle it on, expand settings.

### 6. Test it

Add tests in `plugins/<id>/server/index.test.js` and run them with the server's test command:

```bash
cd server && node --test ../plugins/<id>/server/*.test.js
```

The host's existing tests live under `server/tests/` and won't run your plugin's tests automatically (Phase 1 simplification — Phase 2 will integrate plugin tests into the main run).

### 7. Distribute

For Phase 1, plugins ship by being committed to a plato fork. Open a PR to `1111philo/plato` adding `plugins/<your-id>/`, or maintain the plugin in your own fork.

## Common mistakes

- **Forgetting a capability.** If you use `extensionPoints.slots.adminSettingsPanel`, you must list `"ui.slot.adminSettingsPanel"` in `capabilities`. The validator catches this.
- **Bare imports in plugin code.** `import { Hono } from 'hono'` fails because the plugin folder has no `node_modules`. Use the SDK re-exports.
- **Mutating `_system` directly.** The plugin host owns activation and settings persistence. Use `ctx.setSettings()` from lifecycle/hook contexts, or `PUT /v1/admin/plugins/<id>/settings`.
- **Heavy work in `onActivate`.** It runs synchronously during boot. Schedule background work via `setTimeout(() => doWork(), 0)` or queue it explicitly.
- **Touching files outside `plugins/<id>/`.** Out of scope for plugin authoring. Open a separate PR for core changes.

## Where to look next

- [AGENTS.md](./AGENTS.md) — same content, condensed and recipe-driven
- [EXTENSION_REFERENCE.md](./EXTENSION_REFERENCE.md) — every extension point's signature
- [CAPABILITIES.md](./CAPABILITIES.md) — what each capability authorizes
- `plugins/slack/` — a real, working plugin
