# teacher-comments — gaps hit while building

This file tracks Phase-1 gaps surfaced while building the teacher-comments
plugin. They're filed here rather than in the core docs so future plugin
authors hitting the same friction can find prior art.

## 1. `adminUserRowAction` slot has no host render-point (CLOSED)

**Symptom:** The natural UX for a per-user note is a button on each row in
`/plato/users`. The `adminUserRowAction` slot was declared in the SDK and
capability vocabulary, but `client/src/pages/admin/AdminUsers.jsx` didn't
actually render `<PluginSlot name="adminUserRowAction">`. The plugin's
`UserRowAction.jsx` was registered correctly but rendered nowhere.

**Status:** Fixed in this PR — `AdminUsers.jsx` now renders the slot in the
per-row actions cell. The plugin's button shows up automatically once the
admin enables the plugin.

**Lesson left for the host:** declaring a slot in the SDK without a host
render-point is a half-shipped feature. The SDK type list still has several
more slots in this state (`adminProfileFields`, `adminHomeKpi`,
`learnerProfileFields`, `learnerHomeBanner`). Phase 2+ should land each one
the same way: render-point + capability + worked-example plugin together.

## 2. No per-user metadata storage

**Symptom:** Per-user data is the whole point of this plugin. Phase 1 has
plugin-level settings (one record per plugin) and shared `_system` keys.
Neither fits per-user data.

**Workaround used:** Stuffed everything into the plugin's settings as
`settings.comments = { <userId>: { text, updatedAt, updatedBy } }`. Every
comment write rewrites the entire settings object; concurrent writes
optimistic-lock-conflict. Fine for small classrooms; doesn't scale.

**Better surface (Phase 2):** `userMeta:<pluginId>` sync-data keys per user,
with `user.metadata.read` / `user.metadata.write` capabilities and helpers
on the SDK like `db.getUserMeta(userId, pluginId)` /
`db.putUserMeta(userId, pluginId, data)`.

## 3. No `userCreated` / `userDeleted` hooks

**Symptom:** When a learner is invited and accepts, this plugin would like
to seed an empty comment record (or just be aware so the row-action
indicator shows up immediately). When a user is deleted, this plugin would
like to clean up its `comments[userId]` entry.

**Workaround used:** None. The plugin tolerates missing entries (returns
`{ text: '' }` on read) and tolerates orphaned entries (admin sees a stale
note for a deleted user until they manually clear it).

**Better surface (Phase 2):** core-emitted `userCreated` and `userDeleted`
hooks. The bus already exists in `server/src/lib/plugins/hooks.js` — Phase 2
just needs `emit('userCreated', ...)` calls at the right points in
`server/src/routes/auth.js` and the user-delete paths.

## 4. No way to know which users have plugin data

**Symptom:** When the admin opens `/plato/users`, the row-action button
should ideally show a filled vs. outline icon based on whether a comment
exists. This requires either pre-fetching all comments (we do this in the
settings panel) or one HTTP request per row.

**Workaround used:** The row-action component fetches the comment lazily on
dialog open. The button is always shown unfilled. If we wanted the indicator
state we'd need either a shared client-side cache (none today) or a bulk
"hydrate" API call that returns the per-user data the plugin owns.

**Better surface (Phase 2 or 3):** AdminUsers could pre-fetch
`/v1/plugins/<id>/admin/<bulk endpoint>` once and pass an indicator hint to
each row's slot — but that's a significant slot contract change. Probably
fine to leave this to plugin authors.

## 5. Plugin must hard-code core-endpoint shapes

**Symptom:** `SettingsPanel.jsx` calls `GET /v1/admin/users` directly
because there's no plugin-scoped helper for "list users." If plato changes
the response shape, the plugin breaks.

**Workaround used:** Direct fetch + defensive parsing.

**Better surface:** plugins shouldn't reach into `/v1/admin/*`. Either:
- Add a small "host data" SDK surface (`sdk.getUsers()` etc.) that the host
  controls and versions with `apiVersion`, OR
- Pass commonly-needed lists as slot props (e.g., `learners` to relevant
  slots).

Probably defer until a second plugin needs the same data — premature SDK
expansion is its own anti-pattern.
