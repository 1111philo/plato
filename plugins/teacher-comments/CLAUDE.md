# plugins/teacher-comments/ — Claude / agent instructions

Plugin: Teacher Comments (`teacher-comments`).

Lets admins attach a private text note to each learner. Visible only to admins.
Two surfaces: a per-row "Note" button on `/plato/users` (the canonical UX) and
a fallback panel on `/plato/plugins` that lists every learner with their note.

## Local invariants

- Comments live at `_system:plugins:activation.teacher-comments.settings.comments`,
  a map keyed by `userId`. **Phase-1 storage workaround** — Phase 2 will introduce
  a `userMeta:<pluginId>` namespace; until then every write rewrites the whole
  map and fights for the activation record's optimistic lock. Server retries
  once on conflict.
- Empty `text` deletes the comment entry.
- Admin-only across the board: `routes.use('*', authenticate, requireAdmin)`.
- The plugin reads users via `GET /v1/admin/users` directly. If the host
  endpoint shape changes the plugin breaks (filed in GAPS.md).

## Adding new functionality

1. Pick the extension point from `docs/plugins/EXTENSION_REFERENCE.md` (or the
   `GET /v1/plugins/extension-points` endpoint).
2. Add the matching capability to `plugin.json`.
3. Wire the implementation in `server/index.js` or `client/index.js`.
4. Run `node scripts/validate-plugins.js` before committing.

## Don't

- Don't write to `_system:plugins:activation` for any plugin id other than
  `teacher-comments`. The whole record passes through this plugin's writes —
  it's important to preserve the other plugins' entries.
- Don't expose comment content via any non-admin endpoint. Phase 1 has no
  learner-visible surface, but if Phase 2 adds one, mark fields as `writeOnly`
  in `settingsSchema` so the host strips them from `/v1/plugins`.
- Don't override completion semantics or introduce hard lesson cutoffs.

## Open gaps

See `GAPS.md` in this directory for items the host needs to land before this
plugin can graduate from "Phase-1 demo" to "production-quality."
