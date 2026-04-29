# Capabilities

Every plugin declares the capabilities it uses in `plugin.json#capabilities`. The registry refuses to load a plugin that uses an extension point without the matching capability (`plugin_capability_missing`).

Capabilities exist for three reasons:

1. **Audit.** An admin enabling a plugin sees exactly what it's authorized to do.
2. **Forward-compat.** Phase 2's sandbox model will gate plugins by their declared capability list rather than by inspecting code.
3. **Documentation.** New extension points must add to this vocabulary, forcing the contract to evolve in one place.

## Static capabilities

### `server.routes`

Lets the plugin export a Hono router that gets mounted at `/v1/plugins/<id>/`. The plugin is responsible for its own auth (`authenticate`) and authorization (`requireAdmin` etc.).

Required when `extensionPoints.serverRoutes` is set.

### `settings.read`

Allows the plugin to read its own settings (via `ctx.settings` in lifecycle/hook contexts).

Required when `settingsSchema` is set.

### `settings.write`

Allows the plugin to update its own settings (via `ctx.setSettings()` or via the plugin's own admin endpoint).

Required when `settingsSchema` is set.

### `ui.adminNav`

Lets the plugin contribute an entry to the admin sidebar.

Phase 2. Declared early so plugins can target it as soon as it lands.

### `user.metadata.read`

Allows reading `userMeta:<pluginId>` for any user via the SDK helper
`getUserMeta(userId, pluginId)`. Available since Plugin API 1.1.0.

Phase 1.1+ (declarative; not yet runtime-enforced — same trust model as
`server.routes`).

### `user.metadata.write`

Allows writing `userMeta:<pluginId>` for any user via
`putUserMeta(userId, pluginId, data)` and `deleteUserMeta(userId, pluginId)`.
Available since Plugin API 1.1.0.

By design, `userMeta:*` records are filtered out of the user-visible
`/v1/sync` endpoint. Plugins that want learner-visible per-user data must
expose their own routes.

Phase 1.1+ (declarative).

### `kpi`

Allows contributing KPI definitions that surface in the admin dashboard.

Phase 2.

### `agent`

Allows contributing AI agent prompts (under `prompt:plugin:<id>:<name>` keys) and registering them in the orchestrator's catalog sets.

Phase 3.

### `syncData.namespace`

Allows writing arbitrary `plugin:<id>:*` keys to per-user sync-data. The whitelist regex in `server/src/routes/sync.js` is consulted at write time; only plugins with this capability and a matching `extensionPoints.syncDataNamespace` declaration can write.

Phase 3.

## Pattern capabilities

### `ui.slot.<SlotName>`

Lets the plugin register a component for the named slot. The slot must exist in `SlotName` (defined in `packages/plugin-sdk/index.d.ts` and the JSON Schema enum). Examples:

- `ui.slot.adminSettingsPanel`
- `ui.slot.adminUserRowAction`

Required for every entry in `extensionPoints.slots`.

### `hook.<HookName>`

Lets the plugin subscribe to the named lifecycle hook. The hook must exist in `HookName`. Examples:

- `hook.userCreated`
- `hook.lessonCompleted`

Required for every entry in `extensionPoints.hooks`.

**Note:** the hook bus is open at the implementation level — plugins can `emit()`/`on()` arbitrary names. The capability is required only for *declared core hooks*. Plugin-to-plugin events (convention: `<plugin-id>.<event>`) don't need a capability.

## What capabilities do NOT grant

- Direct access to other plugins' settings or sync-data namespaces
- Ability to mount routes outside `/v1/plugins/<id>/`
- Ability to mutate `_system:settings.*` directly (use `ctx.setSettings()` for the plugin's own settings)
- Ability to call private host APIs not re-exported from `server/src/lib/plugins/sdk.js`

## Adding a new capability

Adding a capability is a core change. The bar:

1. **One real plugin must use it** — no speculative capabilities
2. Update the capability enum in `docs/plugins/plugin.schema.json`
3. Update `STATIC_CAPABILITIES` (or the pattern regex) in `server/src/lib/plugins/capabilities.js`
4. Update the `Capability` type in `packages/plugin-sdk/index.d.ts`
5. Add the capability to this file with a description
6. Update `docs/plugins/EXTENSION_REFERENCE.md` if it corresponds to a new extension point
7. Bump `PLUGIN_API_VERSION` per [API_VERSIONING.md](./API_VERSIONING.md)
8. Add a test in `server/tests/lib/plugins/registry.test.js` proving the new capability gates correctly

## Future: `core.experimental`

Phase 2 may add a `core.experimental` capability that gates direct access to internal APIs (full sync-data read, arbitrary hook subscription) for prototyping new extension points before they land in core. Admin must enable per-plugin with a "⚠️ Uses experimental APIs — may break on plato updates" warning. Modeled on VS Code's proposed APIs. **Not in Phase 1** because committing to an experimental surface this early risks turning it into a permanent escape hatch.
