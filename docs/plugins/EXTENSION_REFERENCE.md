# Extension reference

Flat reference of every plato extension point. One section per surface; no nesting beyond H2 so AI agents can grep and find a single match.

## Slots

### `adminSettingsPanel`

- **Capability:** `ui.slot.adminSettingsPanel`
- **Renders inside:** `client/src/pages/admin/AdminPlugins.jsx` (the plugin card)
- **Props:** `{ pluginId: string, settings: object, onSave: (next) => Promise<void> }`
- **When:** the admin expands "Show settings" on the plugin's card
- **Phase:** 1
- **Example:** `plugins/slack/client/SlackSettingsPanel.jsx`
- **Gotchas:** if you don't ship a custom panel, plato auto-renders a form from `manifest.settingsSchema`. Pick one; don't ship both.

### `adminUserRowAction`

- **Capability:** `ui.slot.adminUserRowAction`
- **Renders inside:** `client/src/pages/admin/AdminUsers.jsx` — actions cell at the right end of each user row, before the Delete button
- **Props:** `{ user: AdminUser }` (see SDK `AdminUser` type)
- **Phase:** 1
- **Example:** `plugins/teacher-comments/client/UserRowAction.jsx`
- **Gotchas:** the host wraps the slot in a `stopPropagation` container so clicks inside the slot don't trigger the row's edit-user navigation. Plugin components don't need their own `stopPropagation`. The slot only renders for confirmed users — invite rows skip the slot.

### `adminHomeKpi`

- **Capability:** `ui.slot.adminHomeKpi`
- **Renders inside:** `client/src/pages/admin/AdminHome.jsx` after `<PacingSection>`
- **Props:** `{}` (KPIs fetch their own data via `/v1/admin/stats/plugins`)
- **Phase:** 2 (declared, not yet rendered)

### `adminProfileFields`

- **Capability:** `ui.slot.adminProfileFields`
- **Renders inside:** `client/src/pages/admin/AdminUsers.jsx` — below the form fields on the Edit User page
- **Props:** `{ user: AdminUser }`
- **Phase:** 1.1
- **Example:** `plugins/teacher-comments/client/ProfileField.jsx` (admin comment thread)
- **Gotchas:** the slot mounts inside the same Card as the form fields. Plugin components should structure their own visual separator (e.g., `<Separator />` + section heading) so they don't blend into the form. Multiple plugins contributing to this slot stack vertically in registration order.

### `learnerProfileFields`

- **Capability:** `ui.slot.learnerProfileFields`
- **Renders inside:** classroom Settings page
- **Props:** `{ profile: LearnerProfile }`
- **Phase:** 2

### `learnerHomeBanner`

- **Capability:** `ui.slot.learnerHomeBanner`
- **Renders inside:** learner home, top of lesson list
- **Props:** `{}`
- **Phase:** 2

## Lifecycle methods

Optional functions a plugin's `server/index.js` default export can declare.
Distinct from event hooks below — these are one-shot host-invoked methods,
not pub-sub events.

### `onActivate(ctx)`

Runs once when admin enables the plugin AND once at boot if the plugin is
already enabled. Idempotent. Use for migrations, cache warmup, seeding. Don't
run heavy work here — it's synchronous in the boot path.

Errors are caught and logged as `plugin_on_activate_failed`; the plugin
continues to run.

### `onDeactivate(ctx)`

Runs when admin disables the plugin. Should release resources, NOT delete
user data. Settings are preserved across disable/enable cycles.

Errors are caught and logged as `plugin_on_deactivate_failed`.

### `onUninstall(ctx)`

Optional. Runs only when an admin uses the "Delete plugin data" flow on
`/plato/plugins`.

- Plugin must be **disabled** first (host refuses otherwise).
- Admin must type the plugin id in a confirm dialog.
- The host clears the plugin's settings/activation entry after `onUninstall`
  completes successfully — every plugin gets that for free.

**Implement `onUninstall` only if your plugin owns data beyond the
activation record** — for example, per-user `userMeta:<id>` records or
`plugin:<id>:*` sync-data namespace records (Phase 3+). For a plugin whose
only state is its settings (e.g. Slack's bot token), no `onUninstall` is
needed; the host's activation-record cleanup is sufficient.

For a plugin that uses `userMeta:<id>`, the cleanup iterates users and
calls `deleteUserMeta`:

```js
async onUninstall(ctx) {
  const users = await db.listAllUsers();
  for (const u of users) {
    if (await getUserMeta(u.userId, ctx.pluginId)) {
      await deleteUserMeta(u.userId, ctx.pluginId);
    }
  }
}
```

**Errors propagate** — unlike `onActivate`/`onDeactivate`, partial-cleanup
failures are surfaced to the admin so they can retry rather than silently
leaving data behind.

The audit log gets a `plugin_data_uninstalled` entry with the admin's user
id and the plugin id.

Available since Plugin API 1.2.0.

## Hooks

The hook bus is at `server/src/lib/plugins/hooks.js`. **Open by design** — any event name works. Plugins MAY emit/subscribe to arbitrary names following the convention `<plugin-id>.<event>`. Core emits a known subset (this list).

### `userCreated`

- **Capability:** `hook.userCreated`
- **Payload:** `{ userId: string, email: string, role: 'admin' | 'user' }`
- **Emit point:** `server/src/routes/auth.js` after `db.createUser` — both the bootstrap-admin path (`POST /v1/auth/bootstrap-admin`) and the invite-accept signup path (`POST /v1/auth/signup`)
- **Fires:** AFTER the user record is persisted. Observe-only; handlers can't abort. Errors in handlers are logged but don't fail the user-facing request.
- **Phase:** 1.1
- **Notes:** Bootstrap admins created at server-startup via env-vars (in `server/src/index.js` and `dev-sqlite.js`) bypass this emit point — the hook bus may not be initialized yet at that boot phase. If you need to react to ALL users including the very first admin, run a sweep on plugin activate.

### `userUpdated`

- **Capability:** `hook.userUpdated`
- **Payload:** `{ userId: string, updates: object }`
- **Emit point:** `server/src/routes/me.js` PATCH `/v1/me`; `server/src/routes/admin.js` PATCH `/v1/admin/users/:id`
- **Phase:** 2 (capability and bus exist; emit-point not yet wired)

### `profileUpdated`

- **Capability:** `hook.profileUpdated`
- **Payload:** `{ userId: string, key: 'profile' | 'profileSummary', data: object }`
- **Emit point:** `server/src/routes/sync.js` after PUT of `profile`/`profileSummary`
- **Phase:** 2

### `lessonStarted`

- **Capability:** `hook.lessonStarted`
- **Payload:** `{ userId: string, lessonId: string, lessonKB: object }`
- **Emit point:** `server/src/routes/sync.js` on first PUT of `lessonKB:<id>` (no prior version)
- **Phase:** 2

### `lessonCompleted`

- **Capability:** `hook.lessonCompleted`
- **Payload:** `{ userId: string, lessonId: string, lessonKB: object }`
- **Emit point:** `server/src/routes/sync.js` on PUT of `lessonKB:<id>` when status flips to `'completed'`
- **Phase:** 2
- **Gotchas:** OBSERVE-ONLY. Hooks fire AFTER the lessonKB is persisted. Plugins MUST NOT participate in the completion decision (that's the coach's job, single-owned by `applyCoachResponseToKB`).

### `coachExchangeRecorded`

- **Capability:** `hook.coachExchangeRecorded`
- **Payload:** `{ userId: string, lessonId: string, messageCount: number }`
- **Phase:** 3

### `userDeleted`

- **Capability:** `hook.userDeleted`
- **Payload:** `{ userId: string, email: string, role: 'admin' | 'user' }`
- **Emit point:** `server/src/routes/me.js` DELETE `/v1/me`; `server/src/routes/admin.js` DELETE `/v1/admin/users/:id`
- **Fires:** BEFORE the cascade. Plugins can read their own `userMeta:<id>` records before they're deleted by the cascade. The host awaits all handlers before proceeding to delete the user's sync-data and user record.
- **Phase:** 1.1
- **Notes:** The user's `userMeta:*` records are auto-deleted by the cascade — plugins don't need to explicitly clean up. Subscribe to this hook only if you have side effects beyond plato (e.g., notify external systems, archive content).

## Capabilities

| Capability | Grants | Phase |
|---|---|---|
| `server.routes` | Mount Hono router under `/v1/plugins/<id>/` | 1 |
| `settings.read` | Read the plugin's own settings record | 1 |
| `settings.write` | Write the plugin's own settings record | 1 |
| `ui.slot.<SlotName>` | Register a component for slot `<SlotName>` | 1+ |
| `ui.adminNav` | Add an admin sidebar link | 2 |
| `hook.<HookName>` | Subscribe to lifecycle hook `<HookName>` | 2+ |
| `user.metadata.read` | Read `userMeta:<pluginId>` per user | 2 |
| `user.metadata.write` | Write `userMeta:<pluginId>` per user | 2 |
| `kpi` | Contribute admin KPIs | 2 |
| `agent` | Contribute AI agent prompt | 3 |
| `syncData.namespace` | Write `plugin:<id>:*` sync-data keys | 3 |

A plugin using an extension point without declaring its capability fails registration with `plugin_capability_missing`.

## Server SDK exports (`server/src/lib/plugins/sdk.js`)

| Export | Purpose |
|---|---|
| `Hono` | Create routers for `routes` |
| `db` | Database access (read/write sync-data, users) |
| `authenticate` | Auth middleware (verifies JWT) |
| `requireAdmin` | Authorization middleware |
| `generateInviteToken` | Crypto helper for invites |
| `APP_URL` | Public URL of the deployment |
| `hostLogger` | Host's ring-buffer logger (rare — prefer `ctx.logger` for plugin-scoped logs) |
| `WebClient` | `@slack/web-api` client (re-exported for the Slack plugin; third-party plugins should declare their own deps) |
| `getUserMeta(userId, pluginId)` | Read the plugin's per-user record. Returns the stored object or `null`. Capability: `user.metadata.read`. Available since 1.1.0. |
| `putUserMeta(userId, pluginId, data)` | Upsert the plugin's per-user record. `data` must be an object. Capability: `user.metadata.write`. Available since 1.1.0. |
| `deleteUserMeta(userId, pluginId)` | Delete the plugin's per-user record. Capability: `user.metadata.write`. Available since 1.1.0. |

**Per-user storage convention:** `userMeta:<pluginId>` is the canonical key
shape. Each plugin gets one record per user. Records are filtered out of the
learner-visible `/v1/sync` listing — admin-only by default. Plugins that want
learner-visible per-user data should expose their own routes.

Adding to this surface is a core change — it widens the public plugin contract.

## Client primitives plugins can import

- `react` (aliased in `client/vite.config.js` to `client/node_modules/react`)
- `@/components/ui/*` — shadcn-style UI primitives (Button, Input, Label, Card, etc.)
- `@/lib/*` — shared client utilities (branding, helpers)
- Relative paths into `client/js/*` (`auth.js` etc.)

## Endpoints

### `GET /v1/admin/plugins`

Admin only. Returns every plugin (enabled, disabled, load-failed) with manifest + settings.

### `PUT /v1/admin/plugins/:id/activation`

Admin only. Body: `{ enabled: boolean }`. Toggles activation. Runs `onActivate`/`onDeactivate`.

### `PUT /v1/admin/plugins/:id/settings`

Admin only. Body: arbitrary settings object. Persists to `_system:plugins:activation.<id>.settings`.

### `GET /v1/plugins`

Authenticated. Returns enabled plugins with sanitized settings (writeOnly fields stripped). Used by the client loader.

### `GET /v1/plugins/extension-points`

Authenticated. Machine-readable inventory of slots, hooks, capabilities, and the host API version. Use this from AI agents to discover what's possible.

### `/v1/plugins/<id>/...`

Plugin-mounted routes. 404 when the plugin is disabled. Auth/authz applied by the plugin's own middleware.
