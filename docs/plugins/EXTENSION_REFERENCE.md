# Extension reference

Flat reference of every plato extension point. One section per surface; no nesting beyond H2 so AI agents can grep and find a single match.

## Slots

### `adminSettingsPanel`

- **Capability:** `ui.slot.adminSettingsPanel`
- **Renders inside:** `client/src/pages/admin/AdminIntegrations.jsx` (the Integrations card)
- **Props:** `{ pluginId: string, settings: object, onSave: (next) => Promise<void> }`
- **When:** the admin expands "Show settings" on the plugin's card
- **Phase:** 1
- **Example:** `plugins/slack/client/SlackSettingsPanel.jsx`
- **Gotchas:** if you don't ship a custom panel, plato auto-renders a form from `manifest.settingsSchema`. Pick one; don't ship both.

### `adminUserRowAction`

- **Capability:** `ui.slot.adminUserRowAction`
- **Renders inside:** `client/src/pages/admin/AdminUsers.jsx` (per-user row action area)
- **Props:** `{ user: AdminUser }` (see SDK `AdminUser` type)
- **Phase:** 2 (declared in SDK, no host render-point yet)

### `adminHomeKpi`

- **Capability:** `ui.slot.adminHomeKpi`
- **Renders inside:** `client/src/pages/admin/AdminHome.jsx` after `<PacingSection>`
- **Props:** `{}` (KPIs fetch their own data via `/v1/admin/stats/plugins`)
- **Phase:** 2 (declared, not yet rendered)

### `adminProfileFields`

- **Capability:** `ui.slot.adminProfileFields`
- **Renders inside:** `client/src/pages/admin/AdminUsers.jsx` (admin user detail panel)
- **Props:** `{ user: AdminUser }`
- **Phase:** 2

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

## Hooks

The hook bus is at `server/src/lib/plugins/hooks.js`. **Open by design** — any event name works. Plugins MAY emit/subscribe to arbitrary names following the convention `<plugin-id>.<event>`. Core emits a known subset (this list).

### `userCreated`

- **Capability:** `hook.userCreated`
- **Payload:** `{ userId: string, email: string, role: 'admin' | 'learner' }`
- **Emit point:** `server/src/routes/auth.js` after `db.createUser`; `server/src/routes/admin.js` after invite-accept
- **Phase:** 2 (capability and bus exist; emit-point lands in Phase 2)

### `userUpdated`

- **Capability:** `hook.userUpdated`
- **Payload:** `{ userId: string, updates: object }`
- **Emit point:** `server/src/routes/me.js` PATCH `/v1/me`; `server/src/routes/admin.js` PATCH `/v1/admin/users/:id`
- **Phase:** 2

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
