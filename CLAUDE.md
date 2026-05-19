# CLAUDE.md

Project-level instructions for Claude Code sessions working on plato.

## Project overview

plato is an Open Source, AI-powered [microlearning](https://philosophers.group/platos-microlearning/) platform. Learners work through focused lessons in a continuous conversation with an AI coach, designed for completion in ~20 minutes.

- `client/` — React 19 + Vite SPA
- `server/` — Node.js + Hono, deployed as AWS Lambda (SAM)
- Brand: "plato" (always lowercase)

## Architecture

- Login required — all data server-side, no offline mode
- Auth: JWT access tokens (15 min) + refresh tokens (30 day), stored in localStorage (`plato_auth`). Login accepts email or username
- Users have a unique `username` (auto-generated if not set, editable, 3-30 chars alphanumeric/hyphens/underscores)
- 2 Lambda functions: API Gateway (buffered CRUD) + Function URL (streaming SSE for AI chat)
- 5 DynamoDB tables: users, invites, refresh-tokens, sync-data, audit-log
- Content stored as `_system` sync-data: `prompt:*`, `lesson:*`, `knowledgeBase`, `settings`
- Prompts are bundled in `client/prompts/*.md` and upserted to DB on every server startup — admins cannot edit prompts directly
- User-created lessons stored under user's own sync-data: `lessons:custom-*`
- Lesson conversation persistence: a learner's chat history for a lesson lives in one `messages:<lessonId>` sync-data record (append-only via `saveLessonMessages`); progress lives separately in `lessonKB:<lessonId>`. **Pasted/uploaded images are NOT embedded in the messages record** — each image is its own `screenshot:<key>` record, and the message stores only `metadata.imageKeys`. This is load-bearing: DynamoDB caps a single item at 400 KB, and inlining base64 screenshots blew the `messages:` record past that limit. The write then failed, but `client/js/storage.js`'s `putSyncData` swallowed the non-409 error, so the in-memory cache looked fine until the next `loadAll()` (on tab refocus) replaced it with the stale server copy — the learner's conversation silently vanished while the small `lessonKB` record survived (issues #191, #193). Images are compressed client-side on paste (`client/src/lib/imageCompression.js`) to stay well under the per-record limit, persisted one-per-record, and excluded from the bulk `GET /v1/sync` payload (fetched on demand by key). `resumeLesson` re-hydrates `imageKeys` → data URLs for rendering via `hydrateMessageImages`. Legacy messages that still embed `imageDataUrls` directly render unchanged, and a lazy, idempotent migration (`migrateLegacyImages`, run from `resumeLesson`) heals pre-fix conversations whose embedded base64 already bloated the record — it extracts each embedded image into a compressed `screenshot:*` record and rewrites the conversation record slim so the lesson can be continued. The migration is skipped while impersonating (`resumeLesson` must stay read-only for the "View as User" audit — writes lack `?asUserId` and would land on the admin's own account). `putSyncData` returns a durability boolean and logs rejected/failed writes instead of swallowing them. The `LessonChat` resume effect keys on stable values (`lessonGroupId`, lesson presence) — never the `lesson` object identity, which changes on every tab refocus and used to re-run the effect and reset the conversation mid-lesson.
- 8 AI agents via Bedrock or Anthropic API (prompt files in `client/prompts/`). Each prompt file has an HTML comment header documenting what it reads, who calls it, and its purpose:
  - **coach** — Reads: lesson prompt, lesson KB, learner profile, program KB. The main learner-facing agent.
  - **lesson-creator** — Reads: program KB. Helps admins design lessons via conversation.
  - **lesson-owner** — Reads: lesson prompt, learner profile. Initializes per-lesson KB.
  - **lesson-extractor** — Reads: conversation text only. Extracts lesson markdown from creation chat.
  - **knowledge-base-editor** — Reads: program KB. Helps admins create/edit the KB via conversation.
  - **knowledge-base-extractor** — Reads: existing KB + conversation. Merges changes into updated KB markdown.
  - **learner-profile-owner** — Reads: learner profile, lesson KB. Full profile update on lesson completion.
  - **learner-profile-update** — Reads: learner profile, activity context. Incremental profile updates during lessons.
- Program Knowledge Base is appended to agent system prompts at runtime for agents in `KB_AGENTS` (`client/js/orchestrator.js`)
- Lesson visibility: lessons have three statuses — `public` (visible to all), `private` (visible only to users in `sharedWith`), and `draft` (in-progress, admin-only, no markdown yet). Drafts surface as a `Draft` pill in Admin → Lessons and are never exposed to learner-facing endpoints. A record is a true draft iff `status === 'draft'` AND markdown is empty; legacy `status: 'draft'` records that *do* have markdown are treated as `private` to preserve pre-rework semantics. Legacy `published` normalizes to `public`.
- Courses: optional taxonomy for grouping lessons. Each course is a first-class `_system:course:<id>` sync-data record with `{ name }`. Each lesson carries an optional `course` field (course ID, like `userGroup` on users). Pure organization — courses don't carry visibility/ACL; lesson visibility is unchanged. The learner-facing `GET /v1/lessons` and `/v1/lessons/:id` endpoints inline `course: { id, name } | null` so the coach context (`buildContext` in `client/src/lib/lessonEngine.js`) can include `course: { name }` when assigned. Admin manages courses via a "Courses" button on Admin → Lessons (mirrors the User Groups pattern on Admin → Users) which opens an accessible modal for create/edit/delete; the lesson editor has a course dropdown that persists changes immediately on edit, and the lessons table has a Course column. Course delete cascades: any lesson whose `course` field referenced the deleted course is rewritten with `course: null`.
- Learner classroom (`/lessons`, `client/src/pages/LessonsList.jsx`): lessons render as a responsive grid (1 col mobile / 2 col sm: / 3 col lg:) with 12 per page. A course filter dropdown sits above the grid; it's hidden when no courses exist (saves screen space in classrooms that don't use the taxonomy). When the filter is set to a course that no longer exists (e.g. the only course was just deleted), the filter snaps back to "All courses" automatically. Filter and page changes are announced to screen readers via an always-mounted `role="status" aria-live="polite"` region — no visible "N lessons" subhead, since sighted users get the same signal from the grid shifting and the pagination row.
- Lesson Catalog appended at runtime: public lessons for `PUBLIC_CATALOG_AGENTS` (coach), all lessons with `[PRIVATE]` tags for `ADMIN_CATALOG_AGENTS` (lesson-creator, knowledge-base-editor)
- Microlearning constraints defined in `client/src/lib/constants.js`: MAX_EXCHANGES=11, MIN_OBJECTIVES=2, MAX_OBJECTIVES=4. Server mirrors in `server/src/lib/lesson-limits.js`. Prompts reference these as literal numbers (update both if changed).
- Pacing: lessons target 11 exchanges (~20 min). **There is no hard cutoff** — lessons always run until the coach awards progress 10. The coach gets escalating `pacingDirective` nudges in the context JSON (at 8+, 11+, 15+, 20+) but these are suggestions, never orders. `client/src/lib/lessonEngine.js` must never auto-complete a lesson based on exchange count; only `parsed.progress >= 10` triggers completion. Philosophy: "move people, not force people" — the coach can always introduce new scaffolding if the learner needs it. `extendedLessons` (completions at 22+ exchanges) is informational only — it signals lesson-design mismatch, not a metric to drive to zero.
- Post-completion feedback mode: once `lessonKB.status === 'completed'`, the thread is feedback-only. `activitiesCompleted` freezes (it's the learning-exchange counter, not a total-turn counter — post-completion chatter doesn't count and would corrupt the `extendedLessons` KPI if it did). `pacingDirective` is suppressed and `postCompletionDirective` replaces it, telling the coach never to coach, assess, or award progress for a *different* lesson inside the same thread. `achieved` is one-shot — only true on the transition turn — so completion side effects (confetti, completion profile update) don't re-fire on subsequent feedback messages. The pure helper `applyCoachResponseToKB` in `lessonEngine.js` is the single owner of this invariant.
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched via `/v1/branding` (public, no auth)
- Admin dashboard at `/plato` (lazy-loaded, role-gated) has two KPI sections:
  - **Learner Engagement** — `Started lessons %` (target ≥90%) and `Completed 50%+ of lessons %` (target >50%). Denominator is non-admin users; "started" = ≥1 `lessonKB:*` record of any status; "completed 50%+" = `lessonsCompleted / lessonsAvailable > 0.5` (strict — exactly 50% does not count). Each widget renders green when on target, red when below.
  - **Lesson Pacing** — on-target rate, over-target count, extended-lesson count.
  - Both sections are powered by `GET /v1/admin/stats/lessons`, which is **stale-while-revalidate cached** in `_system:stats:lessons` sync-data (see `server/src/lib/lesson-stats-cache.js`). Fresh window: 10 min. Stale window (10 min – 24 h): cached payload served and an async Lambda self-invoke kicks off a refresh (`InvocationType: 'Event'`, see the wrapped handler in `server/src/index.js`). Expired (>24 h) or missing: recompute synchronously. The recompute is the only place that walks every user × every sync-data item, so it should never be on the hot path of an admin page load. `lambda:InvokeFunction` scoped to `${StackName}-*` is granted to `PlatoApiFunction` in `template.yaml`. In local dev / tests, `AWS_LAMBDA_FUNCTION_NAME` is unset and the kickoff is a no-op — stale serves remain stale until something crosses MAX_AGE and triggers a sync recompute.
- **Denormalization policy**: plato's source of truth for learner activity is the `sync-data` table (`lessonKB:*`, `messages:*`, etc.). When a read path requires aggregating across many of those records — counts, "last X" timestamps, percentages — the right move is to denormalize a derived field onto a record that's already cheap to fetch (typically the user record), maintained by hooks on the sync write path. The Admin → Users `lessonsCompleted` + `lastActiveAt` fields (#136) are the canonical example. Do this **responsibly**:
  - **Single writer.** Exactly one code path mutates each denormalized field — `server/src/routes/sync.js`'s `applyActivityEffects` for activity counters. No other route writes to these fields directly. This is the only way to keep "two places" from drifting.
  - **Transition detection for status counters.** Plato's coach writes a `lessonKB` multiple times after the lesson completes (post-completion feedback turns keep updating it). Counters that fire on status flips must read the prior record and only increment on the first transition (non-completed → completed). Repeat writes with the same status MUST NOT double-count. The `lessonsCompleted` counter has a dedicated test for this; new counters must too.
  - **Best-effort writes, never blocking.** The primary sync write succeeds first. The counter update is wrapped in try/catch and logged but never thrown. If the counter write fails for any reason (DB hiccup, throttling), the user's lesson data is still correct — only the counter is stale. The lazy-backfill path will heal it on next admin read.
  - **Lazy backfill instead of migrations.** When the read endpoint encounters a record with an undefined counter (legacy user from before the feature), it computes the value from the underlying sync-data once and persists it back. After that, reads are O(1). This avoids a "deploy script" / "data migration" step and means the denormalization is safe to ship at any time.
  - **Source of truth is still the underlying data.** Counters are an index, not authoritative. If drift is ever detected (counter says 5, actual count is 4), the underlying sync-data wins — a manual rebuild script can re-derive counters from scratch. Documented as such so future agents don't treat counters as the canonical record.
  - **Anti-goals.** Don't denormalize fields that change on every learner message (write amplification — the message-rate is plato's hot path). Don't make the primary write fail if the denormalized write fails. Don't add a second write path that updates the same field — keep the single-writer invariant. Don't denormalize values that depend on cross-user state (e.g., a user's "rank in the classroom") — those should be computed per-request from cheap data structures (small classroom-wide lists) instead.
- Per-user activity panel (issue #136): admins see a learner's lesson activity on the Admin → Users edit-user view, deep-linked at `/plato/users/:userId` so refresh and browser-back preserve the selection. The edit-user state is derived from the URL via `useParams`; `openEditUser` navigates rather than setting state directly. A bad userId (e.g. user deleted) silently redirects back to `/plato/users`. `UserStatsPanel` (`client/src/pages/admin/UserStatsPanel.jsx`) fetches `GET /v1/admin/users/:userId/stats` and renders three summary tiles (a CompletionRing for completed/available with color thresholds at 35%/90%, logins-in-window count, median completion time with p90 sub) and a list of completed lessons. Computed on demand — no precomputation. UI uses "completed" / "completion time" rather than "mastered" / "time to mastery" because the underlying field is `lessonKB.status === 'completed'` — calling it mastery would imply a quality claim we don't measure (just that the coach awarded progress 10). Duration is exchange-based (`activitiesCompleted × MINS_PER_EXCHANGE`) for consistency with `/v1/admin/stats/lessons` — wall-clock minutes inflate from multi-session lessons. Logins come from audit-log `user_login` entries (written by `/v1/auth/login`; the audit-log table has no GSI on userId, so reads use Scan-with-filter — fine at current scale, revisit at ~100k entries). The Admin → Users table opt-in `?include=stats` adds `lessonsCompleted`, `lessonsAvailable`, and `lastActiveAt` to each row; the Completed column renders a compact CompletionRing colored by progress. **Stats reads are O(1) per user**: `lessonsCompleted` and `lastActiveAt` are denormalized onto the user record. `lessonsCompleted` is maintained by a sync-route PUT hook in `server/src/routes/sync.js` (`applyActivityEffects`) — a first-time `lessonKB:*` status transition from non-completed → 'completed' bumps the counter; repeat writes with the same status (post-completion feedback turns) do not double-count. `lastActiveAt` is **not** updated on `messages:*` writes (that would cause write amplification on the hot path — see denormalization anti-goals); instead it's updated on `/v1/auth/login` and `/v1/auth/refresh`, which gives a natural ~15-minute heartbeat while a learner is active (access-token TTL). All activity writes are best-effort (try/catch, swallowed) — the primary sync/login/refresh succeeds regardless, and stat fields self-heal via lazy backfill: on `?include=stats`, any user with an undefined counter is computed once from their sync-data and persisted back, so the scan cost is paid at most once per legacy user. The lessonKB pre-read (used to detect the status transition) is itself wrapped in try/catch — a failed pre-read just defaults old-status to null, so the worst case is one missed counter increment, never a failed lesson write. `lessonsAvailable` is computed per-request from the small classroom-wide lesson list (cheap regardless of user count). Columns are sortable (click header to cycle asc/desc with aria-sort + a polite live region announcing the change); nullish values always sort last regardless of direction so invites (which lack user-stat fields) cluster predictably. Modals/dropdowns that don't need stats call the base endpoint to skip the lessons-available computation entirely.
- Admin "View as User": admins can audit a learner's classroom (their lesson list, conversation history, lesson KB) without asking for screenshots. Triggered from a "View as user" button in the purple admin bar in the classroom (`AppShell`); a yellow status strip with an "Exit" button surfaces underneath the admin bar while impersonation is active. Implementation: read-only `?asUserId=<id>` query param threaded onto GET `/v1/sync*` and GET `/v1/lessons*` from `client/js/auth.js`'s `authenticatedFetch`; admin-gated server-side. Writes never carry the param — server returns 403 on PUT/DELETE with `?asUserId=` (defense-in-depth) and `client/src/lib/lessonEngine.js`'s `startLesson`/`sendMessage` throw at the top to belt-and-suspenders the disabled `ComposeBar`. Impersonation state lives in `sessionStorage('plato_impersonation')` (per-tab) and `AuthContext`. `AuthContext.startImpersonation` / `stopImpersonation` clear the storage cache *and* hard-reload to `/lessons`; clearing the cache alone wasn't enough because `AppContext` (lesson list, per-lesson progress badges) holds component state that wouldn't otherwise re-fetch. For an audit/security feature, "no stale data" beats a faster transition. Audit-logged at session granularity (`admin_view_as_user_started` / `_ended`) — per-read entries would spam the log. POST `/v1/admin/impersonation/start` `{ targetUserId }` writes the start entry and returns the target profile for the banner; POST `/v1/admin/impersonation/end` is best-effort (no-op if the admin closes the tab — the start entry is the source of truth for "an admin looked").
- Server logging: `server/src/lib/logger.js` — ring-buffer logger keyed by snake_case `code` strings (not free-form messages). Each call mirrors a structured JSON line to stdout that includes `logId`, so Lambda → CloudWatch captures the same shape and the endpoint can dedupe events retrieved from both lanes. `GET /v1/admin/logs` merges the in-process buffer with CloudWatch (Lambda has `logs:FilterLogEvents` scoped to `/aws/lambda/${AWS::StackName}-*` plus `logs:DescribeLogGroups` on `*` since that action doesn't support per-group scoping). The log-group prefix for queries is derived from stage (prod → `/aws/lambda/plato-`, playground → `/aws/lambda/plato-playground-`) to match CloudFormation's naming — the prod stack is bare `plato`, not `plato-prod`. CloudWatch is queried with two required-term patterns (`ERROR` and `"Task timed out"`) — never the all-optional `?FOO ?BAR` form, which CloudWatch treats as match-everything. Each `FilterLogEvents` query is **fully paginated** (`filterAllPages` follows `nextToken`) — an earlier non-paginated `limit: 100` returned only the oldest ~100 matches and silently dropped the most recent errors, which is how a high-count data-loss error stayed invisible for 8 days (#195). Node process warnings (`(node:N) Warning: …`, e.g. the AWS SDK `NodeVersionSupportWarning`) are dropped by `isProcessWarning` — Lambda tags those stderr lines `ERROR` so they match the filter, but they are noise and unfiltered they bury real errors. For the prod stage, `belongsToStage` excludes `/aws/lambda/plato-playground-*` groups, since the prod prefix `/aws/lambda/plato-` is also a prefix of every playground group. The pilot agent (via `scripts/pilot-report.js`) is the primary consumer: response is pre-aggregated into `groups` by code with counts, firstSeen/lastSeen, and a sample entry; the report includes a **Data-loss watch** callout flagging `unhandled_error` on `PUT`/`POST` `/v1/sync` (failed learner-data writes). The pilot workflow itself no longer needs AWS credentials (no `AWS_ROLE_ARN` secret, no `aws-actions/configure-aws-credentials` step — all log reads are proxied through the endpoint via admin JWT). CloudWatch failures populate `cloudwatch.error` instead of silently returning empty. **Before adding any new error detection or alert, read `docs/OBSERVABILITY.md`** — it defines the three-tier model (A critical/per-occurrence, B degraded/threshold, C noise/filter) and the decision guide for where a new check belongs.

## Plugins

plato has a manifest-driven plugin system modeled on VS Code/Vite/WordPress patterns. Plugins live in `plugins/<id>/` and are bundled into the SAM build (no runtime code uploads — Lambda's read-only FS rules that out). The admin UI at `/plato/plugins` lets admins toggle activation and configure plugins.

```
plugins/
  slack/                       # built-in plugin (the Slack invite UI lives here, not in admin.js)
  ...
docs/plugins/
  README.md                    # quickstart
  AUTHORING.md                 # human guide
  AGENTS.md                    # AI-agent guide (decision tree, recipes, DO-NOT list)
  EXTENSION_REFERENCE.md       # flat reference of every slot/hook/capability
  CAPABILITIES.md              # capability vocabulary + audit guidance
  API_VERSIONING.md            # semver policy + deprecation window
  EXAMPLES.md                  # walkthroughs at increasing complexity
  plugin.schema.json           # machine-readable manifest spec
  templates/                   # copy-paste-ready code templates
packages/plugin-sdk/index.d.ts # TypeScript types for plugin authors
server/src/lib/plugins/        # plugin host: registry, manifest, hooks, lifecycle, logger, sdk
client/src/lib/plugins/        # client host: loader, <PluginSlot>, SettingsForm
scripts/
  create-plato-plugin.js       # scaffolder
  validate-plugins.js          # CI gate (validates every manifest)
```

**Anti-goals (plugins MUST NOT):** override completion semantics (`applyCoachResponseToKB` is the single owner), introduce hard exchange-count cutoffs, write to `_system:settings.*` directly, read or write another plugin's settings, mount routes outside `/v1/plugins/<id>/`, modify files outside their own `plugins/<id>/` folder.

**When changing the plugin contract:** bump `PLUGIN_API_VERSION` in `server/src/lib/plugins/version.js`, update `docs/plugins/plugin.schema.json` capability/slot/hook enums, update `packages/plugin-sdk/index.d.ts` types, update `docs/plugins/EXTENSION_REFERENCE.md`. The capability vocabulary table in `docs/plugins/CAPABILITIES.md` is the single source of truth for what's documented vs. what's implemented.

**Core plugin tests** live alongside each plugin (`plugins/<id>/server/*.test.js`). Plugin host tests live at `server/tests/lib/plugins/*.test.js`.

## Development

```bash
cd client && npm install && cd ../server && npm install
cd server && cp .env.example .env   # add your Anthropic API key
node dev-sqlite.js
```

Client hot reload: `cd client && npm run dev` (port 5173, proxies API to :3000)

## Testing

```bash
cd server && npm test
```

AI route tests mock `ai-provider.js` (not `bedrock.js`).

## Deploy to AWS

```bash
cd client && npm ci && npm run build
cd ../server && sam build
cp -r ../client/dist .aws-sam/build/PlatoStreamFunction/client-dist
cp -r ../client/dist .aws-sam/build/PlatoApiFunction/client-dist
mkdir -p .aws-sam/build/PlatoApiFunction/client-content .aws-sam/build/PlatoStreamFunction/client-content
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoApiFunction/client-content/
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoStreamFunction/client-content/
# Plugins (server-side) — the registry walks plugins/<id>/server/index.js at boot
cp -r ../plugins .aws-sam/build/PlatoApiFunction/plugins
cp -r ../plugins .aws-sam/build/PlatoStreamFunction/plugins
# version.json is generated at deploy time from the latest Beta-RC-* tag
VERSION=$(git describe --tags --abbrev=0 --match='Beta-RC-*' 2>/dev/null || echo 'Beta-RC-0')
echo "{\"version\":\"${VERSION}\"}" > .aws-sam/build/PlatoApiFunction/version.json
cp .aws-sam/build/PlatoApiFunction/version.json .aws-sam/build/PlatoStreamFunction/version.json
sam deploy
```

The copy steps are required — SAM doesn't build the client. `client-dist` serves the SPA; `client-content` provides prompt and lesson source files for seeding.

Deploy config: `server/samconfig.toml` (copy from `samconfig.toml.example`, gitignored). See README.md for full deploy guide including CI/CD setup.

### Environments

The `template.yaml` accepts a `Stage` parameter (`prod` or `playground`). Each stage gets its own DynamoDB tables and SSM parameters:

- **prod** (`plato` stack) — learn.ai-leaders.org, auto-deploys on push to `main` (via `repository_dispatch` → private fork)
- **playground** (`plato-playground` stack) — playground.ai-leaders.org, auto-deploys on push to `playground` (via `repository_dispatch` → private fork)

SSM parameters (per stage): `/plato/{stage}/jwt-secret`, `/plato/{stage}/admin-email`, `/plato/{stage}/admin-password`, `/plato/{stage}/ses-from-email`, `/plato/{stage}/app-url`

### Backups

Prod DynamoDB tables have two backup layers:

- **PITR** (Point-in-Time Recovery) — continuous, restores to any second in the last 35 days
- **Pre-deploy snapshots** — the prod deploy workflow creates on-demand backups of all 5 tables before each deploy, keeping the last 5 per table

## CloudFront

The site is served via CloudFront -> Lambda Function URL. The Origin Request Policy **must** be `AllViewerExceptHostHeader` — Lambda Function URLs reject requests where the Host header doesn't match their domain.

## Conventions

- Accessibility is required: every interactive element must be keyboard-operable and have an accessible name (aria-label, aria-pressed, role, etc.)
- Chat accessibility: the chat log uses `role="log"` with `aria-live="off"` and `aria-label="Chat log"` to prevent VoiceOver hijacking. New message announcements go through a separate `role="status"` live region that auto-clears ~3s after each announcement so stale text doesn't persist as navigable content. Streaming `AssistantMessage` components must set `streaming` prop to hide from screen readers. Individual messages are plain `<div>`s (no `role="article"`, no per-message `aria-label`) with inline sr-only speaker prefixes ("Coach says:" / "You said:") that flow as content, plus `data-chat-message` attributes for Alt+Arrow keyboard navigation (`useChatKeyboardNav` hook). The Objectives dialog moves focus to its title on open so screen readers announce the dialog's purpose. `useTitleNotification` hook flashes document title for background tab notifications. `ComposeBar` sends on Cmd/Ctrl+Enter; plain Enter inserts a newline.
- Always commit and push after changes
- **PR workflow for collaborative iteration**: when implementing a feature interactively with a user (multi-turn iteration, browser testing, UX tweaks), open the PR as **Draft** (`gh pr create --draft`) — or hold commits locally and don't open a PR yet. Only mark Ready (`gh pr ready <n>`) when the user explicitly says it's ready to ship. If a Ready PR is already open and more iteration starts, convert it back to Draft (`gh pr ready <n> --undo`). Reason: every push to a Ready PR triggers the full CI suite (auto-review on Bedrock, CodeQL, lint × 2). Micro-commits during design iteration produce noise on the PR timeline and waste Bedrock budget. This rule does NOT apply to plato-pilot PRs (`pilot.yml` opens them Ready by design — they're standalone proposals, not iteration loops) or to one-line bugfixes the user already approved up front.
- Run `npm test` before deploying
- Version is tag-based (`Beta-RC-X`). On push to main, `.github/workflows/version-bump.yml` creates the next `Beta-RC-N` git tag + GitHub release. There's no `version.json` tracked in git — the deploy workflow generates it from the latest tag before packaging Lambda. Local dev: no version.json means the admin sidebar hides the version label; that's intentional.
- Deploy workflows live only in the private fork (UIC-OSF/learn.ai-leaders.org), not in the public repo. Deploys are automated via `repository_dispatch`: pushing to `main` here triggers `.github/workflows/trigger-deploy.yml`, which fires a `deploy-prod` dispatch to the private fork; pushing to `playground` fires `deploy-playground`. The private fork's `deploy.yml` / `deploy-playground.yml` listen for those events, check this repo out at the dispatched SHA, and run SAM deploy. No more pushing to the deploy remote. One-time setup: a `DEPLOY_DISPATCH_TOKEN` secret on this repo (fine-grained PAT with `contents:write` on the deploy fork). Manual deploy: run `Trigger Deploy` here via `workflow_dispatch` with a `target` input (`prod` / `playground` / `both` — `both` fires simultaneous deploys to both envs), or run `Deploy to AWS` / `Deploy to Playground` directly from the private fork's Actions tab with an optional `ref` input (branch/tag/SHA on this repo).
- `main` and `playground` are ruleset-protected (required PR + 1 approving review + passing `review` status check from the Code Review workflow; no force pushes; no deletion). Blake as repository admin is on the bypass list with `bypass_mode: always` for emergency overrides.
- Auto code review: `.github/workflows/code-review.yml` runs on every PR (opened + synchronize) and posts a review as `claude[bot]`. Reviews are per-commit idempotent: the guard step queries existing reviews and skips when a `claude[bot]` review already exists for the current head sha. New commits (different sha) — including `revise.yml`'s fixup pushes — still get reviewed. The job still completes when skipped so the required `review` status check is satisfied. The reviewer prompt explicitly instructs the agent to submit exactly ONE `gh pr review` call (the agent was previously double-posting inside a single run). Reviewers must call out live-user impact explicitly and end every review body with a one-line `User impact:` summary — because merges auto-deploy to prod, the review is the last human-free checkpoint. A post-action verify step fails the job if the agent exits without posting a review (caught a silent-no-op failure mode where the SDK returns success but never calls `gh pr review`). Only one automated reviewer should be active at a time; if the hosted Claude GitHub App (github.com/apps/claude) is also installed with auto-review enabled, disable it there to prevent duplicate reviews.
- Issue intake: `.github/workflows/issue-intake.yml` runs on every newly opened issue and classifies it as either `ready-for-pilot` or `needs-info`. To qualify as `ready-for-pilot`, the issue must name something concrete: an exact string/copy change, a specific error message or screenshot, or a named component plus observed-vs-expected behavior. Vague reports ("updated headings needed", "make X better") go to `needs-info` with ≤3 clarifying questions — a false-positive `needs-info` is cheap, a false-positive `ready-for-pilot` fuels pilot loops. Non-bug issues get no label, no comment. Idempotent via the labels.
- plato-pilot: `.github/workflows/pilot.yml` runs weekday mornings (ET). Per run, it reads `/tmp/pilot-report.md` (KPIs, error codes, open pilot PRs as a **blocklist of issues with an open PR**, pilot merge-rate track record, tier-classified `ready-for-pilot` issues with each issue's author surfaced as `(by @login)` or `_(self-filed)_`), then picks ONE signal or SKIPs. **Severity interrupt** (evaluated before the picking order): a data-loss-class server error — `unhandled_error` / 5xx on a `PUT`/`POST` write to `/v1/sync` (surfaced by the report's Data-loss watch callout) — outranks the entire issue queue regardless of count; the pilot fixes it or escalates with a loud `SKIP: ESCALATING …` line, never defers it silently. This exists because a 400 KB write-size bug lost learner conversations for 8 days while the pilot worked one-line copy issues (#195). **Strict picking order** (top-down — first match wins, no jumping ahead because something later looks higher-impact): (1) community-authored `ready-for-pilot` issue (author ≠ `plato-pilot`), tier-ranked then oldest-first; (2) self-filed `ready-for-pilot` issue; (3) high-count server error on a learner-facing surface; (4) KPI signal. Volume is not a tie-breaker against authored issues — a one-line community issue beats a 50-instance error — **except** a data-loss-class error, which the severity interrupt lifts above everything. When the pick is issue-driven, the agent commits with a `Co-Authored-By: <issue-author> <login@users.noreply.github.com>` trailer so GitHub credits the issue author as a contributor on the merge commit. Tiers: 1 (learner experience: exemplars, coach, profiles) → 5 (DevOps). Every pilot PR body must include a Triage table (Signal / Source / Tier / Decision / Why) plus a `User impact: low/medium/high` line so the maintainer can audit blast radius at a glance. The blocklist is built from **every open PR** that references an issue via `Fixes/Closes/Resolves #N`, not just `plato-pilot`-labeled PRs — so a maintainer-authored PR claiming a `ready-for-pilot` issue blocks the pilot from racing it (closing the dup-gap that produced #160). A pre-agent step emits the blocklist to `/tmp/pilot-blocklist.txt` and a post-agent step closes any PR that references a blocked issue (hard dup-gate — the advisory prose version was repeatedly ignored). A final step auto-escalates looping issues: when ≥2 closed-unmerged pilot PRs reference the same `ready-for-pilot` issue, the step removes the label, adds `needs-info`, and posts a comment asking the reporter to clarify. Anti-goals (never violate): no hard lesson cutoffs, no pacing directive tightening, `extendedLessons` is informational only.
- log-watch: `.github/workflows/log-watch.yml` runs every 2 hours and is plato's data-loss alarm — separate from plato-pilot (a once-weekday fix-proposer, not a monitor). `scripts/log-watch.js` logs into the admin API, reads `GET /v1/admin/logs?view=groups`, and if any `unhandled_error` group's sample is a `PUT`/`POST` to `/v1/sync` (a learner-data write failing server-side) it opens a GitHub issue labelled `data-loss` + `ready-for-pilot`. Idempotent: while a `data-loss` issue is open it suppresses duplicates — close the issue once the failure is fixed. No AWS credentials (the endpoint proxies CloudWatch); uses the same `PLATO_API_URL` / `PLATO_ADMIN_EMAIL` / `PLATO_ADMIN_PASSWORD` secrets as the pilot. Exists because a write-size bug lost learner conversations for 8 days unnoticed (#195).
- Claude workflow auth: `pilot.yml`, `code-review.yml`, `issue-intake.yml`, and `revise.yml` all use **AWS Bedrock via OIDC**. Each job has `id-token: write`, runs `aws-actions/configure-aws-credentials@v4` to assume `${{ secrets.AWS_BEDROCK_ROLE_ARN }}` in `us-east-2`, then passes `use_bedrock: "true"` to `anthropics/claude-code-action@v1`. Models are pinned via `--model` in `claude_args` to Bedrock cross-region inference profiles: `us.anthropic.claude-sonnet-4-5-20250929-v1:0` for review/pilot, `us.anthropic.claude-haiku-4-5-20251001-v1:0` for intake/revise. The role is `arn:aws:iam::722741357267:role/plato-github-bedrock` (separate AWS account from prod plato). Bedrock cross-region inference profiles route across us-east-1/us-east-2/us-west-2, so model access must be granted in all three regions on the role's account. No `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` secrets are used — Bedrock is the only auth lane. (Earlier OAuth attempts failed with 401 from the Anthropic API; rather than wait for the Anthropic-side bug to clear, the workflows route through Bedrock's IAM auth instead.)
- API responses for user groups use `{ userGroups: [...] }` consistently
- Emails use classroom name/colors from settings, with "Powered by plato." footer linking to GitHub
- Auth pages (login, signup, forgot-password, reset-password) use `usePublicBranding` hook for classroom theming
- Classroom pages use `BrandingProvider` context
- Admin pages (`/plato/*`) are never themed with classroom branding
- Footer text: "Powered by plato." (with period, with GitHub link)
- User-created lesson IDs start with `custom-`
- `loadLessons()` merges system lessons (`/v1/lessons`) with user lessons from sync-data
- Favicon: defaults to plato's; generated dynamically when admin uploads a logo image (logo on rounded-rect with primary color)
- Lesson visibility: new lessons start as `draft` the moment the Lesson Creator conversation begins (one `lesson:<id>` record per draft in `_system` sync-data), so admins can pause a draft and resume it later, or work on multiple drafts in parallel. Clicking "Create Lesson" finalizes the same record with extracted markdown and flips status `draft` → `private` (shared only with author). Admins toggle public/private on finalized lessons and manage shared users via the Share modal. Drafts hide the Share icon since there's nothing shareable yet.
- No admin lesson preview — admins preview lessons by sharing with themselves and viewing in the classroom
- Lesson editing: conversation-based via the Lesson Creator agent (no raw markdown editor)
- Knowledge base: created/edited by admins via the KB Editor agent in the Customizer (not directly editable)
- Admin nav order: Home, Lessons, Users, Customizer, Plugins (course management lives inside Admin → Lessons)

## Key files

- `server/template.yaml` — SAM/CloudFormation infrastructure
- `server/src/lib/email.js` — SES email templates (invite, reset)
- `server/src/lib/ai-provider.js` — AI abstraction (Bedrock or Anthropic API)
- `client/src/contexts/BrandingContext.jsx` — classroom branding for authenticated pages
- `client/src/hooks/usePublicBranding.js` — classroom branding for auth pages
- `client/src/lib/branding.js` — shared branding utilities (CSS vars, favicon gen)
- `client/src/lib/lessonCreationEngine.js` — lesson creation conversation flow
- `client/js/lessonOwner.js` — lesson loading and markdown parsing
- `client/js/storage.js` — sync-data cache and persistence
- `client/src/lib/imageCompression.js` — downscales pasted screenshots so each `screenshot:*` record stays under DynamoDB's 400 KB item limit
- `client/js/orchestrator.js` — AI agent orchestration
- `client/src/hooks/useChatKeyboardNav.js` — Alt+Arrow keyboard navigation between chat messages
- `client/src/hooks/useTitleNotification.js` — document title flash for new-message notifications
- `client/src/lib/constants.js` — microlearning limits (MAX_EXCHANGES, MIN/MAX_OBJECTIVES, MINS_PER_EXCHANGE) and shared constants
- `server/src/lib/lesson-limits.js` — server-side mirror of microlearning limits
- `client/src/pages/admin/UserStatsPanel.jsx` — per-user activity widget for the Admin → Users edit view
- `client/src/pages/admin/CompletionRing.jsx` — SVG donut showing completed / available lessons, color-coded (red <35%, yellow 35–89%, green ≥90%)
