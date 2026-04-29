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

**Closed:** `AdminUsers.jsx` now renders the slot in the per-row actions
cell. The plugin's button shows up automatically once the admin enables it.

## 2. No per-user metadata storage (CLOSED in Plugin API 1.1.0)

**Symptom:** Per-user data is the whole point of this plugin. Phase 1
shipped only plugin-level settings (one record per plugin). Stuffing all
comments into `settings.comments = { <userId>: ... }` made every write
rewrite the entire settings record; concurrent writes optimistic-lock-
conflicted.

**Closed in 1.1.0:** SDK helpers `getUserMeta(userId, pluginId)`,
`putUserMeta(userId, pluginId, data)`, `deleteUserMeta(userId, pluginId)`.
Each plugin's per-user data lives in its own DB record at
`userMeta:<pluginId>`, scoped to the user. Write contention is per-user,
not per-plugin. Records are auto-deleted by the user-delete cascade and
filtered out of the learner-visible `/v1/sync` listing.

The plugin migrated to this storage in the same release. Capability:
`user.metadata.read` / `user.metadata.write`.

## 3. No `userCreated` / `userDeleted` emit-points (CLOSED in Plugin API 1.1.0)

**Symptom:** When a learner is invited and accepts, this plugin would like
to react (e.g., seed an external CRM). When a user is deleted, plugins with
side effects beyond plato (Slack notifications, archiving) need to know.

**Closed in 1.1.0:** core now emits `userCreated` after `db.createUser`
(both bootstrap-admin and signup) and `userDeleted` before the user-data
cascade in both `me.js` DELETE `/v1/me` and `admin.js` DELETE
`/v1/admin/users/:id`. teacher-comments doesn't subscribe to either —
the user-delete cascade auto-cleans the plugin's per-user records, and
teacher-comments has no need to seed on userCreated. Hooks are exercised
by `server/tests/routes/lifecycle-hooks.test.js`.

## 4. No way to know which users have plugin data (still open)

**Symptom:** When the admin opens `/plato/users`, the row-action button
should ideally show a filled vs. outline icon based on whether a comment
exists. Today the row-action component fetches the comment lazily on
dialog open; the button is always shown unfilled.

**Workaround used:** Lazy fetch on dialog open. Acceptable; the indicator
state is a UX nicety, not a correctness issue.

**Better surface (future):** AdminUsers could pre-fetch
`/v1/plugins/<id>/admin/<bulk endpoint>` once and pass an indicator hint to
each row's slot — but that's a significant slot contract change. Probably
fine to leave to plugin authors.

## 5. Plugin must hard-code core-endpoint shapes (still open)

**Symptom:** `SettingsPanel.jsx` calls `GET /v1/admin/users` directly
because there's no plugin-scoped helper for "list users." If plato changes
the response shape, the plugin breaks.

**Workaround used:** Direct fetch + defensive parsing.

**Better surface (future):** plugins shouldn't reach into `/v1/admin/*`.
Either add a small "host data" SDK surface (`sdk.getUsers()` etc.) that
the host versions with `apiVersion`, or pass commonly-needed lists as slot
props (e.g., `learners` to relevant slots). Defer until a second plugin
needs the same data.
