# plugins/teacher-comments/ — Claude / agent instructions

Plugin: Teacher Comments (`teacher-comments`).

A traditional comment thread per learner, rendered on the admin Edit User page.
Multiple comments per user, each with author attribution and timestamp.
Append-only from the admin's perspective (no in-place editing — delete and
re-add). Visible only to admins.

## Local invariants

- Each user's thread lives at `userMeta:teacher-comments` on that user, shape
  `{ comments: [{ id, text, createdAt, authorId, authorName }] }`. Newest
  comment first when read.
- Reads tolerate the legacy single-comment shape
  (`{ text, updatedAt, updatedBy }`) so notes from the prior version aren't
  lost — converted to a one-item thread on the fly.
- Comment IDs use the prefix `cm_` (or `cm_legacy_` for converted entries).
  Generated server-side.
- Admin-only across the board (`routes.use('*', authenticate, requireAdmin)`).
  `userMeta:*` records are filtered from the learner-visible `/v1/sync` listing
  by the host — don't relax that filter.
- The `delete` endpoint targets a single `commentId`. Deleting the last
  comment removes the underlying `userMeta:teacher-comments` record entirely
  (clean slate).
- The plugin reads users via `GET /v1/admin/users` directly. Filed in GAPS.md.

## Adding new functionality

1. Pick the extension point from `docs/plugins/EXTENSION_REFERENCE.md` (or the
   `GET /v1/plugins/extension-points` endpoint).
2. Add the matching capability to `plugin.json`.
3. Wire the implementation in `server/index.js` or `client/index.js`.
4. Run `node scripts/validate-plugins.js` before committing.

## Teardown

`onUninstall` iterates every user and deletes their `userMeta:teacher-comments`
record. Errors propagate so the admin sees a partial-cleanup failure rather
than a silent half-purge. Triggered only via the gated "Delete plugin data"
flow on `/plato/plugins` (plugin must be disabled + admin must type the id
to confirm). The host clears the activation/settings entry afterwards.

## Don't

- Don't import core modules outside the SDK (`server/src/lib/plugins/sdk.js`)
  unless you've added a re-export there first.
- Don't allow comments to be edited in place — append + delete keeps the
  audit story clean.
- Don't expose comment content to learners via any route. Phase 2 has no
  learner-visible surface for this plugin.
- Don't override completion semantics or introduce hard lesson cutoffs.
