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

**`ctx.settings` can lag behind a save by up to 30 s.** Each Lambda
container keeps its own copy of every plugin's on/off state and settings.
The registry re-reads `_system:plugins:activation` before every admin plugin
read or write (so the Plugins page and saves always use the stored record),
and on other requests at most every 30 s (`pluginRegistry.sync`). A hook
that must see a save immediately, like Slack auto-invite's channel, should
read the activation record fresh with the SDK's `db`.

The hook bus is at `server/src/lib/plugins/hooks.js`. **Open by design** — any event name works. Plugins MAY emit/subscribe to arbitrary names following the convention `<plugin-id>.<event>`. Core emits a known subset (this list).

### `userCreated`

- **Capability:** `hook.userCreated`
- **Payload:** `{ userId: string, email: string, role: 'admin' | 'educator' | 'learner' | 'tester' }` (normalized; accounts stored as `user` before API 1.4.0 report `learner`)
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
- **Payload:** `{ userId: string, lessonId: string, lesson: { name, markdown, exemplar, learningObjectives, coachDirective? }, lessonKB: object, trace?: true }`. `trace: true` is present only when the learner is recording a Trace (API 1.7.0); see [Tracing what your plugin did](#tracing-what-your-plugin-did-api-170).
- **Returns:** an enrichment object, or `null`. Optionally `trace: [step, …]` beside the enrichment.
- **Emit point:** `server/src/routes/sync.js` POST `/v1/sync/lesson-started` — called by `client/src/lib/lessonEngine.js#startLesson()` after the Lesson Owner agent initializes the KB but before the Coach opens the conversation
- **Phase:** 1 (wired)
- **Gotchas:** Plugins can use this to enrich the lesson at start time (e.g., fetch external docs, add context from a knowledge base). The lesson markdown and objectives are included so plugins can decide whether to act. Enrichment responses (if the plugin returns data) are collected by the endpoint and stored on `lessonKB.enrichments`. Plugins MUST fail open — errors must never block lesson start.

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
- **Payload:** `{ userId: string, email: string, role: 'admin' | 'educator' | 'learner' | 'tester' }` (normalized; accounts stored as `user` before API 1.4.0 report `learner`)
- **Emit point:** `server/src/routes/me.js` DELETE `/v1/me`; `server/src/routes/admin.js` DELETE `/v1/admin/users/:id`
- **Fires:** BEFORE the cascade. Plugins can read their own `userMeta:<id>` records before they're deleted by the cascade. The host awaits all handlers before proceeding to delete the user's sync-data and user record.
- **Phase:** 1.1
- **Notes:** The user's `userMeta:*` records are auto-deleted by the cascade — plugins don't need to explicitly clean up. Subscribe to this hook only if you have side effects beyond plato (e.g., notify external systems, archive content).

## Enrichment Pattern

The `lessonStarted` hook + `lessonEnrichment` capability enable a powerful pattern: plugins can inject additional reference material into lessons at start time. The host collects enrichment responses, stores them on `lessonKB.enrichments`, injects them into the coach's system context, and displays them to the learner as collapsible artifact panels.

### Use cases
- **External docs** — fetch WordPress.org docs, React API references, MDN articles
- **Knowledge bases** — query internal wikis, Confluence, Notion
- **Recent updates** — pull latest bug reports, release notes, deprecation warnings
- **Company context** — add org-specific best practices, security policies, code standards

### Contract

A `lessonStarted` hook handler with `lessonEnrichment` capability can return an enrichment object:

```js
{
  pluginId: 'wordpress-info',       // Required: your plugin id
  label: 'WordPress.org',            // Required: display name shown to learner
  context: 'When building custom...',// Required: ~300 word summary for the coach
  reasoning: 'This lesson focuses...', // Required: why this context matters
  sources: [                         // Optional: citation links
    { url: 'https://...', title: '...', excerpt: '...' }
  ]
}
```

**Return `null`** (or omit the return) when your plugin doesn't enrich this lesson. The host filters out nulls — only non-null returns are stored.

### Lifecycle

1. Learner starts a lesson → `client/src/lib/lessonEngine.js#startLesson()` calls `POST /v1/sync/lesson-started`
2. Server emits `lessonStarted` hook with `{ userId, lessonId, lesson, lessonKB }` (plus `trace: true` when the learner is recording a Trace)
3. Each plugin handler runs; non-null returns are collected
4. Server returns `{ enrichments: [...] }` to client (plus `pluginTraces` on a traced call)
5. Client stores `lessonKB.enrichments` (one-time — never re-runs on resume)
6. `buildContext()` injects enrichments into coach system prompt
7. `LessonChat` renders `<EnrichmentArtifact>` above first coach message

### Tracing what your plugin did (API 1.7.0)

Trace mode (#595) lets a person read everything behind a lesson conversation: every AI call with what was sent and what came back, what plato's code did, and what went to outside services. Your handler runs on the server, where the learner's browser can't see it, so **a plugin that hooks `lessonStarted` must report its own work**. `client/tests/transparency.test.js` fails for one that doesn't.

When the learner is recording, the payload has `trace: true` and the host gives that one call a recorder. When they aren't, nothing below runs and nothing is returned.

**What the host does for you**

| You call | What is recorded |
|---|---|
| `ctx.ai.invoke(ctx.LLM, body, { purpose })` (or `invokeStream`) | An `ai` step, by itself: the `system` and `messages` you sent, the reply, token usage, the time taken, and the provider's error if it failed. `purpose` is one line saying what the call is for. |
| `ctx.trace.fetch(purpose, url, init)` | A `fetch` step: the URL, status, time taken, and the size when the server states one. It returns the `Response` untouched and rethrows a failure. |
| `ctx.trace.note(text)` | A `note` step: a decision or outcome worth telling a person ("The planner decided this lesson doesn't need WordPress material"). |
| `ctx.trace.record(step)` | Any step below, for work the helpers don't cover. |

`ctx.trace.on` is `true` on a traced call. On every other call `ctx.trace` is a stand-in: `on` is `false`, `note` and `record` do nothing, and `fetch` is plain `fetch`. So you write one code path:

```js
async function onLessonStarted({ lesson }, ctx) {
  const plan = await ctx.ai.invoke(ctx.LLM, { max_tokens: 1024, messages: [...] }, { purpose: 'Decide what to search for' });
  const res = await ctx.trace.fetch('Search the docs', `https://docs.example.com/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) { ctx.trace.note('The docs search failed, so nothing was added.'); return null; }
  // …
  return { pluginId: 'my-plugin', label: 'Docs', context, reasoning, sources };
}
```

A plugin that must also load on a host older than 1.7.0 reads `ctx.trace?.on` and falls back to `fetch`.

**Step shapes**

```ts
{ type: 'ai', purpose, model, system, messages: [{ role, content }], reply, usage?, ms?, error? }
{ type: 'fetch', purpose, url, status?, ms?, bytes?, error? }
{ type: 'note', text }
```

A handler may also return its steps as `trace: [step, …]` beside the enrichment (or `{ trace: [...] }` alone when it adds no enrichment). Steps recorded through `ctx.trace` and `ctx.ai` come first, in the order recorded; returned steps follow. Steps are kept even when the handler returns `null` or throws, so a person can see why nothing was added.

**What the host does to every step** (`server/src/lib/plugins/trace.js`)

- Keeps only the three types and the fields listed above. Anything else is dropped, so headers and request bodies can't ride along.
- Caps each text field at 20,000 characters (`purpose`, `model`, `error` at 500; a URL at 2,000), with a note of how much was left out. Non-text message content (an image) is named, not copied. At most 50 messages per `ai` step.
- Keeps at most **50 steps** and **200 KB** per plugin per lesson start (250 KB across all plugins, shared equally when over), and closes with a note when steps were left out.
- From a URL, removes `user:password@`, the fragment, and the value of any query parameter named like a credential (`token`, `key`, `secret`, `signature`, …). Only `http(s)` URLs are kept.
- From text, removes what looks like an `Authorization`, API-key or `Cookie` header and `Bearer …` / `Basic …` tokens.
- Never throws. A bad step is dropped, a bad trace is empty, and your enrichment is returned either way.

**Rules for plugin authors**

- **Never put a secret in a step**: no tokens, keys, cookies or auth headers, and no plugin setting marked `writeOnly`. The scrubbing above is a backstop, not permission. Any signed-in user can ask for a trace, and it is stored in that user's own data.
- **Record what was actually sent and received**, not a summary or a tidied version. `ctx.ai` and `ctx.trace.fetch` do this for you; with `record`, pass the real `system`, `messages` and reply.
- **Don't change what you do because a trace was asked for.** The same AI calls and requests must go out traced or not.
- **Keep nothing between calls.** The recorder belongs to one call of your handler. Two learners can start lessons at once in one server, so never store `ctx.trace`, or steps, in a module-level variable.
- The trace never reaches the coach. The host returns it as `pluginTraces: { [pluginId]: steps }`, apart from `enrichments`, and takes a `trace` key off anything you return before it is stored on `lessonKB.enrichments`.

### Fail-open requirements

**Plugins MUST fail open** — enrichment errors must never block lesson start. The reference implementation (WordPress Info plugin) demonstrates:

- Planner returns `{ shouldEnrich: false }` → no enrichment (learner sees normal lesson)
- Query executor timeout or API error → empty results → no enrichment
- Synthesizer error → no enrichment
- Hook handler throws → host catches error, logs `plugin_hook_failed`, skips that plugin

### Example: WordPress Info plugin

Three-agent pipeline:
1. **Planner** (`prompts/wordpress-info-planner.md`) — detects WordPress keywords in lesson objectives, outputs `{ shouldEnrich: bool, queries: [{ text, sources }] }`
2. **Query executor** — fetches from wordpress.org REST API, Make WordPress blogs, GitHub code search in parallel
3. **Synthesizer** (`prompts/wordpress-info-synthesizer.md`) — distills results into lesson-specific summary

Hook handler returns enrichment data or `null`. See `plugins/wordpress-info/` for the full implementation.

### Anti-goals

- ❌ Don't override completion semantics — enrichment is informational only; the coach (`applyCoachResponseToKB`) remains the single owner of progress
- ❌ Don't delay lesson start beyond ~3-5 seconds — use timeouts, caching, or background jobs for slow sources
- ❌ Don't inline huge docs — the synthesizer should distill to ~300 words
- ❌ Don't re-run enrichment on every chat turn — it's computed once at start and cached on `lessonKB`

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
| `lessonEnrichment` | Enrich lessons at start with additional context | 1 |
| `auth.provider` | Supply a single sign-on provider; core runs the flow and owns accounts ([SSO](../SSO.md)) | 1.6 |

A plugin using an extension point without declaring its capability fails registration with `plugin_capability_missing`.

## Server SDK exports (`src/lib/plugins/sdk.js`)

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
shape. Each plugin gets one record per user.

**Learner isolation** — `userMeta:*` records are admin-owned. Every learner-
facing path that touches the user's own sync-data excludes them:

  - `GET /v1/sync` (bulk) — filtered out of the listing
  - `GET /v1/sync/:dataKey` (single) — rejected by the key whitelist regex
  - `PUT /v1/sync/:dataKey` — rejected by the key whitelist regex
  - `DELETE /v1/sync/:dataKey` (single) — rejected by the key whitelist regex
  - `DELETE /v1/sync` (bulk reset of own data) — `userMeta:*` preserved
  - `GET /v1/me/export` (download my data) — `userMeta:*` filtered out

The only paths that delete `userMeta:*` are account-deletion (DELETE /v1/me
self-delete; DELETE /v1/admin/users/:id admin-delete) and a plugin's own
`onUninstall` hook. Both account-deletion paths fire `userDeleted` BEFORE
the cascade so plugins can read their data on the way out if needed.

Plugins that want learner-visible per-user data should expose their own
routes.

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

Admin only. Body: arbitrary settings object. Persists to `_system:plugins:activation.<id>.settings`. A string longer than its property's declared `maxLength` in `settingsSchema` is refused with 400 (API 1.6.1); nothing else in the schema is enforced on the server, so validate what you read.

### `GET /v1/plugins`

Authenticated. Returns enabled plugins with sanitized settings (writeOnly fields stripped). Used by the client loader. Because writeOnly values never reach the client, `PUT /v1/admin/plugins/:id/settings` keeps a stored writeOnly value when the body leaves it out; send `null` to clear it (API 1.5.1).

### `GET /v1/plugins/extension-points`

Authenticated. Machine-readable inventory of slots, hooks, capabilities, and the host API version. Use this from AI agents to discover what's possible.

### `/v1/plugins/<id>/...`

Plugin-mounted routes. 404 when the plugin is disabled. Auth/authz applied by the plugin's own middleware.
