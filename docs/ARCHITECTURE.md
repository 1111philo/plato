# plato Architecture — subsystem deep-dives

Detailed design notes and incident history for plato's load-bearing subsystems.
`CLAUDE.md` carries the one-line invariants; this doc carries the *why* and the
*how it broke*. Read the relevant section before changing one of these systems.

## Data & content model

- Login required — all data is server-side, no offline mode. Auth: JWT access
  tokens (15 min) + refresh tokens (30 day), stored in localStorage
  (`plato_auth`). Login accepts email or username. Users have a unique
  `username` (auto-generated if unset, editable, 3–30 chars
  alphanumeric/hyphens/underscores).
- 2 Lambda functions: API Gateway (buffered CRUD) + Function URL (streaming SSE
  for AI chat).
- 5 DynamoDB tables: users, invites, refresh-tokens, sync-data, audit-log.
- Content stored as `_system` sync-data: `prompt:*`, `lesson:*`,
  `knowledgeBase`, `settings`.
- Prompts are bundled in `client/prompts/*.md` and upserted to DB on every
  server startup — admins cannot edit prompts directly.
- User-created lessons stored under the user's own sync-data:
  `lessons:custom-*`. User-created lesson IDs start with `custom-`.
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched
  via `/v1/branding` (public, no auth).

## AI agents

8 AI agents via Bedrock or Anthropic API (prompt files in `client/prompts/`).
Each prompt file has an HTML comment header documenting what it reads, who calls
it, and its purpose:

- **coach** — Reads: lesson prompt, lesson KB, learner profile, program KB. The main learner-facing agent.
- **lesson-creator** — Reads: program KB. Helps admins design lessons via conversation.
- **lesson-owner** — Reads: lesson prompt, learner profile. Initializes per-lesson KB.
- **lesson-extractor** — Reads: conversation text only. Extracts lesson markdown from creation chat.
- **knowledge-base-editor** — Reads: program KB. Helps admins create/edit the KB via conversation.
- **knowledge-base-extractor** — Reads: existing KB + conversation. Merges changes into updated KB markdown.
- **learner-profile-owner** — Reads: learner profile, lesson KB. Full profile update on lesson completion.
- **learner-profile-update** — Reads: learner profile, activity context. Incremental profile updates during lessons.

Context appended at runtime (`client/js/orchestrator.js`):

- **Program Knowledge Base** appended to agent system prompts for agents in `KB_AGENTS`.
- **Lesson Catalog**: public lessons for `PUBLIC_CATALOG_AGENTS` (coach); all
  lessons with `[PRIVATE]` tags for `ADMIN_CATALOG_AGENTS` (lesson-creator,
  knowledge-base-editor).
- Knowledge base is created/edited by admins via the KB Editor agent in the
  Customizer (not directly editable).

## Image & conversation persistence (#191, #193)

A learner's chat history for a lesson lives in one `messages:<lessonId>`
sync-data record (append-only via `saveLessonMessages`); progress lives
separately in `lessonKB:<lessonId>`.

**Pasted/uploaded images are NOT embedded in the messages record.** Each image
is its own `screenshot:<key>` record, and the message stores only
`metadata.imageKeys`. This is load-bearing:

- DynamoDB caps a single item at 400 KB. Inlining base64 screenshots blew the
  `messages:` record past that limit. The write then failed, but
  `client/js/storage.js`'s `putSyncData` swallowed the non-409 error, so the
  in-memory cache looked fine until the next `loadAll()` (on tab refocus)
  replaced it with the stale server copy — the learner's conversation silently
  vanished while the small `lessonKB` record survived.
- Images are compressed client-side on paste
  (`client/src/lib/imageCompression.js`) to stay well under the per-record
  limit, persisted one-per-record, and excluded from the bulk `GET /v1/sync`
  payload (fetched on demand by key).
- `resumeLesson` re-hydrates `imageKeys` → data URLs for rendering via
  `hydrateMessageImages`. Legacy messages that still embed `imageDataUrls`
  directly render unchanged.
- A lazy, idempotent migration (`migrateLegacyImages`, run from `resumeLesson`)
  heals pre-fix conversations whose embedded base64 already bloated the record:
  it extracts each embedded image into a compressed `screenshot:*` record and
  rewrites the conversation record slim so the lesson can be continued. The
  migration is **skipped while impersonating** (`resumeLesson` must stay
  read-only for the "View as User" audit — writes lack `?asUserId` and would
  land on the admin's own account).
- `putSyncData` returns a durability boolean and logs rejected/failed writes
  instead of swallowing them.
- The `LessonChat` resume effect keys on stable values (`lessonGroupId`, lesson
  presence) — **never the `lesson` object identity**, which changes on every tab
  refocus and used to re-run the effect and reset the conversation mid-lesson.

## Lessons: visibility, drafts, courses, classroom

### Visibility

Lessons have three statuses:

- `public` — visible to all (legacy `published` normalizes to `public`).
- `private` — visible only to users in `sharedWith`.
- `draft` — in-progress, admin-only, no markdown yet.

A record is a **true draft** iff `status === 'draft'` AND markdown is empty;
legacy `status: 'draft'` records that *do* have markdown are treated as
`private` to preserve pre-rework semantics. Drafts surface as a `Draft` pill in
Admin → Lessons and are never exposed to learner-facing endpoints.

New lessons start as `draft` the moment the Lesson Creator conversation begins
(one `lesson:<id>` record per draft in `_system` sync-data), so admins can pause
and resume drafts or work on several in parallel. Clicking "Create Lesson"
finalizes the same record with extracted markdown and flips status
`draft` → `private` (shared only with author). Admins toggle public/private on
finalized lessons and manage shared users via the Share modal. Drafts hide the
Share icon (nothing shareable yet).

### Courses

Optional taxonomy for grouping lessons. Each course is a first-class
`_system:course:<id>` sync-data record with `{ name }`. Each lesson carries an
optional `course` field (course ID, like `userGroup` on users). Pure
organization — courses don't carry visibility/ACL; lesson visibility is
unchanged. The learner-facing `GET /v1/lessons` and `/v1/lessons/:id` inline
`course: { id, name } | null` so the coach context (`buildContext` in
`client/src/lib/lessonEngine.js`) can include `course: { name }` when assigned.
Admin manages courses via a "Courses" button on Admin → Lessons (mirrors the
User Groups pattern); the lesson editor has a course dropdown that persists
immediately on edit; the lessons table has a Course column. Course delete
cascades: any lesson whose `course` referenced the deleted course is rewritten
with `course: null`.

### Learner classroom

`/lessons` (`client/src/pages/LessonsList.jsx`): lessons render as a responsive
grid (1 col mobile / 2 col `sm:` / 3 col `lg:`) with 12 per page. A course
filter dropdown sits above the grid; it's hidden when no courses exist. When the
filter is set to a course that no longer exists, it snaps back to "All courses"
automatically. Filter and page changes are announced via an always-mounted
`role="status" aria-live="polite"` region — no visible "N lessons" subhead.

`loadLessons()` merges system lessons (`/v1/lessons`) with user lessons from
sync-data. To preview a lesson as a learner sees it (the live coach experience),
admins share the lesson with themselves and view it in the classroom — the
editor preview only renders the lesson markdown.

### Lesson editor

Editing is conversation-based via the Lesson Creator agent (no raw markdown
editor). The editor is deep-linked at `/plato/lessons/:lessonId/edit` (mirrors
the `users/:userId` pattern) so it survives reload and browser-back.
`/plato/lessons/new` mints a fresh `admin-<ms>` draft id and `replace`-redirects
to that edit URL — the draft record is created lazily by the editor's first
auto-save. The edit route fetches the lesson on mount; a missing/deleted lesson
redirects to `/plato/lessons`, but a 404 on a freshly-minted draft id (within
`FRESH_DRAFT_WINDOW_MS`, i.e. not yet auto-saved) opens create mode instead of
bouncing. `AdminLessons` keys `NewLessonView` on `lessonId` so switching lessons
remounts cleanly.

**Markdown preview pane** (`client/src/pages/admin/LessonPreviewPane.jsx`):
chat left, rendered lesson markdown right, stacking below `lg`. The preview is
**manually refreshed** via a "Generate preview" / "Refresh preview" button that
re-runs the `lesson-extractor` agent (`extractLessonMarkdown`) — it does NOT
auto-update per message and runs no AI call on editor open. On open the pane
shows the lesson's already-saved markdown (edit) or a quiet empty-state (new
draft). Once the conversation advances past the last refresh a "Preview may be
outdated" hint appears. The preview is **not persisted** — a standing note tells
the admin to click "Create/Update Lesson" to save. `buildConversationText`
(`client/src/lib/lessonCreationEngine.js`) is the shared builder for the
`lesson-extractor` input, used by both the finalize and preview-refresh paths.

## Pacing & completion philosophy

Microlearning constraints live in `client/src/lib/constants.js`:
`MAX_EXCHANGES=11`, `MIN_OBJECTIVES=2`, `MAX_OBJECTIVES=4`,
`MINS_PER_EXCHANGE=1.8`. Server mirrors them in
`server/src/lib/lesson-limits.js`. Prompts reference these as literal numbers
(update both if changed).

Lessons target 11 exchanges (~20 min). **There is no hard cutoff** — lessons
always run until the coach awards progress 10. The coach gets escalating
`pacingDirective` nudges in the context JSON (at 8+, 11+, 15+, 20+) but these
are suggestions, never orders. `client/src/lib/lessonEngine.js` must **never**
auto-complete a lesson based on exchange count; only `parsed.progress >= 10`
triggers completion. Philosophy: "move people, not force people" — the coach can
always introduce new scaffolding if the learner needs it. `extendedLessons`
(completions at 22+ exchanges) is informational only — it signals lesson-design
mismatch, not a metric to drive to zero.

### Post-completion feedback mode

Once `lessonKB.status === 'completed'`, the thread is feedback-only.

- `activitiesCompleted` freezes (it's the learning-exchange counter, not a
  total-turn counter — post-completion chatter doesn't count and would corrupt
  the `extendedLessons` KPI if it did).
- `pacingDirective` is suppressed and `postCompletionDirective` replaces it,
  telling the coach never to coach, assess, or award progress for a *different*
  lesson inside the same thread.
- `achieved` is one-shot — only true on the transition turn — so completion side
  effects (confetti, completion profile update) don't re-fire on subsequent
  feedback messages.

The pure helper `applyCoachResponseToKB` in `lessonEngine.js` is the **single
owner** of this invariant.

## Denormalization policy

plato's source of truth for learner activity is the `sync-data` table
(`lessonKB:*`, `messages:*`, etc.). When a read path requires aggregating across
many of those records — counts, "last X" timestamps, percentages — the right
move is to denormalize a derived field onto a record that's already cheap to
fetch (typically the user record), maintained by hooks on the sync write path.
The Admin → Users `lessonsCompleted` + `lastActiveAt` fields (#136) are the
canonical example. Do this **responsibly**:

- **Single writer.** Exactly one code path mutates each denormalized field —
  `server/src/routes/sync.js`'s `applyActivityEffects` for activity counters. No
  other route writes these fields directly. This is the only way to keep "two
  places" from drifting.
- **Transition detection for status counters.** The coach writes a `lessonKB`
  multiple times after completion (post-completion feedback turns keep updating
  it). Counters that fire on status flips must read the prior record and only
  increment on the first transition (non-completed → completed). Repeat writes
  with the same status MUST NOT double-count. `lessonsCompleted` has a dedicated
  test for this; new counters must too.
- **Best-effort writes, never blocking.** The primary sync write succeeds first.
  The counter update is wrapped in try/catch and logged but never thrown. If it
  fails, the user's lesson data is still correct — only the counter is stale, and
  lazy-backfill heals it on next admin read.
- **Lazy backfill instead of migrations.** When the read endpoint encounters a
  record with an undefined counter (legacy user), it computes the value once and
  persists it back. After that, reads are O(1). No deploy-time migration step.
- **Source of truth is still the underlying data.** Counters are an index, not
  authoritative. On drift, the underlying sync-data wins; a manual rebuild script
  can re-derive counters from scratch.
- **Anti-goals.** Don't denormalize fields that change on every learner message
  (write amplification — message-rate is plato's hot path). Don't make the
  primary write fail if the denormalized write fails. Don't add a second write
  path for the same field. Don't denormalize values that depend on cross-user
  state (e.g. a user's "rank in the classroom") — compute those per-request from
  cheap classroom-wide lists.

### Per-user activity stats (#136)

Admins see a learner's lesson activity on the Admin → Users edit-user view,
deep-linked at `/plato/users/:userId` so refresh and browser-back preserve the
selection. The edit-user state is derived from the URL via `useParams`;
`openEditUser` navigates rather than setting state directly. A bad userId
silently redirects back to `/plato/users`.

`UserStatsPanel` (`client/src/pages/admin/UserStatsPanel.jsx`) fetches
`GET /v1/admin/users/:userId/stats` and renders three summary tiles (a
CompletionRing for completed/available with color thresholds at 35%/90%,
logins-in-window count, median completion time with p90 sub) and a list of
completed lessons. Computed on demand — no precomputation.

- UI uses "completed" / "completion time" rather than "mastered" / "time to
  mastery" because the underlying field is `lessonKB.status === 'completed'` —
  calling it mastery would imply a quality claim we don't measure.
- Duration is exchange-based (`activitiesCompleted × MINS_PER_EXCHANGE`) for
  consistency with `/v1/admin/stats/lessons` — wall-clock minutes inflate from
  multi-session lessons.
- Logins come from audit-log `user_login` entries (written by `/v1/auth/login`;
  the audit-log table has no GSI on userId, so reads use Scan-with-filter — fine
  at current scale, revisit at ~100k entries).

The Admin → Users table opt-in `?include=stats` adds `lessonsCompleted`,
`lessonsAvailable`, and `lastActiveAt` to each row; the Completed column renders
a compact CompletionRing colored by progress. **Stats reads are O(1) per user**:
`lessonsCompleted` and `lastActiveAt` are denormalized onto the user record.

- `lessonsCompleted` is maintained by the sync-route PUT hook
  (`applyActivityEffects`) — a first-time `lessonKB:*` transition non-completed →
  'completed' bumps the counter; repeat writes with the same status do not
  double-count.
- `lastActiveAt` is **not** updated on `messages:*` writes (write amplification —
  see anti-goals); instead it's updated on `/v1/auth/login` and `/v1/auth/refresh`,
  giving a natural ~15-min heartbeat (access-token TTL).
- All activity writes are best-effort (try/catch, swallowed). Stat fields
  self-heal via lazy backfill on `?include=stats`. The lessonKB pre-read (used to
  detect the transition) is itself wrapped in try/catch — a failed pre-read just
  defaults old-status to null, so the worst case is one missed increment, never a
  failed lesson write.
- `lessonsAvailable` is computed per-request from the small classroom-wide lesson
  list (cheap regardless of user count).
- Columns are sortable (click header to cycle asc/desc with aria-sort + a polite
  live region); nullish values always sort last regardless of direction so
  invites cluster predictably. Modals/dropdowns that don't need stats call the
  base endpoint to skip the lessons-available computation.

`CompletionRing` (`client/src/pages/admin/CompletionRing.jsx`) is an SVG donut
showing completed / available lessons, color-coded (red <35%, yellow 35–89%,
green ≥90%).

### Admin dashboard KPIs

Admin dashboard at `/plato` (lazy-loaded, role-gated) has two KPI sections:

- **Learner Engagement** — `Started lessons %` (target ≥90%) and
  `Completed 50%+ of lessons %` (target >50%). Denominator is non-admin users;
  "started" = ≥1 `lessonKB:*` record of any status; "completed 50%+" =
  `lessonsCompleted / lessonsAvailable > 0.5` (strict — exactly 50% does not
  count). Each widget renders green on target, red below.
- **Lesson Pacing** — on-target rate, over-target count, extended-lesson count.

Both are powered by `GET /v1/admin/stats/lessons`, which is **stale-while-
revalidate cached** in `_system:stats:lessons` sync-data (see
`server/src/lib/lesson-stats-cache.js`). Fresh window: 10 min. Stale window
(10 min–24 h): cached payload served and an async Lambda self-invoke kicks off a
refresh (`InvocationType: 'Event'`, see the wrapped handler in
`server/src/index.js`). Expired (>24 h) or missing: recompute synchronously. The
recompute is the only place that walks every user × every sync-data item, so it
should never be on the hot path of an admin page load. `lambda:InvokeFunction`
scoped to `${StackName}-*` is granted to `PlatoApiFunction` in `template.yaml`.
In local dev / tests, `AWS_LAMBDA_FUNCTION_NAME` is unset and the kickoff is a
no-op.

## Admin "View as User"

Admins can audit a learner's classroom (lesson list, conversation history,
lesson KB) without asking for screenshots. Triggered from a "View as user"
button in the purple admin bar in the classroom (`AppShell`); a yellow status
strip with an "Exit" button surfaces underneath while impersonation is active.

- Read-only `?asUserId=<id>` query param threaded onto GET `/v1/sync*` and GET
  `/v1/lessons*` from `client/js/auth.js`'s `authenticatedFetch`; admin-gated
  server-side.
- **Writes never carry the param** — server returns 403 on PUT/DELETE with
  `?asUserId=` (defense-in-depth), and `client/src/lib/lessonEngine.js`'s
  `startLesson`/`sendMessage` throw at the top to belt-and-suspenders the
  disabled `ComposeBar`.
- Impersonation state lives in `sessionStorage('plato_impersonation')` (per-tab)
  and `AuthContext`. `startImpersonation` / `stopImpersonation` clear the storage
  cache *and* hard-reload to `/lessons` — clearing the cache alone wasn't enough
  because `AppContext` (lesson list, per-lesson progress badges) holds component
  state that wouldn't otherwise re-fetch. For an audit feature, "no stale data"
  beats a faster transition.
- Audit-logged at session granularity (`admin_view_as_user_started` / `_ended`)
  — per-read entries would spam the log. POST `/v1/admin/impersonation/start`
  `{ targetUserId }` writes the start entry and returns the target profile for
  the banner; POST `/v1/admin/impersonation/end` is best-effort (no-op if the
  admin closes the tab — the start entry is the source of truth).
