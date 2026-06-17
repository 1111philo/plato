# CLAUDE.md

Project-level instructions for Claude Code sessions working on plato.

## Project overview

plato is an Open Source, AI-powered [microlearning](https://philosophers.group/platos-microlearning/) platform. Learners work through focused lessons in a continuous conversation with an AI coach, designed for completion in ~20 minutes.

- `client/` — React 19 + Vite SPA
- `server/` — Node.js + Hono, deployed as AWS Lambda (SAM)
- Brand: "plato" (always lowercase)

## Architecture

Quick map of the system. **Deep dives, incident history, and the *why* behind these invariants live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — read the relevant section before changing one of these subsystems.

- Login required, all data server-side. JWT access (15 min) + refresh (30 day) tokens in localStorage (`plato_auth`); login accepts email or username. Unique editable `username` per user.
- 2 Lambda functions (API Gateway buffered CRUD + Function URL streaming SSE for AI chat); 5 DynamoDB tables (users, invites, refresh-tokens, sync-data, audit-log).
- Content is `_system` sync-data (`prompt:*`, `lesson:*`, `knowledgeBase`, `settings`). Prompts are bundled in `client/prompts/*.md` and upserted on every server startup — admins can't edit prompts directly. User-created lessons live under the user's sync-data (`lessons:custom-*`).
- **9 AI agents** via Bedrock or Anthropic API (prompts in `client/prompts/`, each with an HTML header documenting reads/callers/purpose): coach, lesson-creator, lesson-owner, lesson-extractor, knowledge-base-editor, knowledge-base-extractor, learner-profile-owner, learner-profile-update, course-progress-update. Program KB + Lesson Catalog are appended to system prompts at runtime (`client/js/orchestrator.js`).
- **Conversation & image persistence** — chat history is one append-only `messages:<lessonId>` record; progress is a separate `lessonKB:<lessonId>`. **Images are never inlined in `messages:`** — each is its own compressed `screenshot:*` record, referenced by `metadata.imageKeys` (DynamoDB's 400 KB item cap; inlining base64 silently lost conversations, #191/#193). The `LessonChat` resume effect keys on stable values, never the `lesson` object identity. → [details](docs/ARCHITECTURE.md#image--conversation-persistence-191-193)
- **Link attachments** — a learner can attach a web page to a coach message. It's fetched + read **server-side** (`POST /v1/links/fetch`); the page text is injected into the coach call on that turn only (image parity), and only `{ url, title }` is persisted in `metadata.links`. SSRF defense (`server/src/lib/url-guard.js`) is load-bearing — the server fetches user URLs from inside AWS. → [details](docs/ARCHITECTURE.md#link-attachments)
- **Lessons** — three statuses: `public`, `private` (visible to `sharedWith`), `draft` (admin-only, no markdown yet; true draft iff `status==='draft'` AND markdown empty). New lessons start as `draft`; "Create Lesson" flips `draft`→`private`. Editing is conversation-based (no raw markdown editor), deep-linked at `/plato/lessons/:lessonId/edit`, with a manually-refreshed markdown preview pane. An optional `## Coach Directive` section carries author-supplied runtime instructions for the coach (e.g. "reference the learner's project", "share this code") — extracted verbatim, parsed into `lesson.coachDirective`, and surfaced via `buildContext`; it never overrides completion semantics. Optional `course` taxonomy (`_system:course:<id>`) for grouping; delete cascades `course:null`. A per-learner `courseProgress:<courseId>` record carries a tiny distilled note of what the learner demonstrated in a course's *other* lessons — regenerated on completion by the `course-progress-update` agent (incremental, ~600-char cap) and injected into the coach context as `course.progress`; informational only, never overrides completion. → [details](docs/ARCHITECTURE.md#course-progress-cross-lesson-memory)
- **Pacing & completion** — limits in `client/src/lib/constants.js` (MAX_EXCHANGES=11, MIN/MAX_OBJECTIVES=2/4, MINS_PER_EXCHANGE=1.8), mirrored in `server/src/lib/lesson-limits.js`; prompts use the literal numbers. **No hard cutoff** — lessons run until the coach awards `progress >= 10`. Never auto-complete on exchange count. `extendedLessons` is informational only. Post-completion the thread is feedback-only; `applyCoachResponseToKB` (`lessonEngine.js`) is the single owner of completion semantics. → [details](docs/ARCHITECTURE.md#pacing--completion-philosophy)
- **Denormalization** — derived activity fields (`lessonsCompleted`, `lastActiveAt`) are denormalized onto the user record with a **single writer** (`applyActivityEffects` in `server/src/routes/sync.js`), transition-detected (no double-count), best-effort. Underlying sync-data stays the source of truth. **All dashboard/per-user KPIs count only published (public) lessons** — drafts, privates (even when shared), and custom lessons are excluded from numerator *and* denominator (`server/src/lib/lesson-visibility.js`); a completion counts iff its lesson id maps to a public `_system:lesson:*`. The `?include=stats` user-list recomputes `lessonsCompleted` per request and heals the counter (visibility can't be derived from the stored count alone). Per-user stats (#136) and Admin dashboard KPIs build on this. → [details](docs/ARCHITECTURE.md#denormalization-policy)
- **Admin "View as User"** — read-only learner-classroom audit via `?asUserId=<id>` on GET `/v1/sync*` and `/v1/lessons*`; writes never carry the param (403 server-side + client throw). Session-granularity audit log. → [details](docs/ARCHITECTURE.md#admin-view-as-user)
- **Observability** — errors flow `server/src/lib/logger.js` (snake_case `code`) → `GET /v1/admin/logs` (merges ring buffer + CloudWatch, aggregates by `code`) → pilot report + log-watch alarm. **Before adding any error detection or alert, read [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md)** (the three-tier model + decision guide).

## Plugins

Manifest-driven plugin system modeled on VS Code/Vite/WordPress. Plugins live in `plugins/<id>/` and are bundled into the SAM build (no runtime code uploads — Lambda's read-only FS). The admin UI at `/plato/plugins` toggles activation and configures plugins.

- Host code: `server/src/lib/plugins/` (registry, manifest, hooks, lifecycle, sdk), `client/src/lib/plugins/` (`<PluginSlot>`, loader, SettingsForm). Types in `packages/plugin-sdk/index.d.ts`. Docs in `docs/plugins/` (README, AUTHORING, AGENTS, EXTENSION_REFERENCE, CAPABILITIES, API_VERSIONING, EXAMPLES, schema, templates). Scaffolder `scripts/create-plato-plugin.js`; CI gate `scripts/validate-plugins.js`.
- **Anti-goals (plugins MUST NOT):** override completion semantics (`applyCoachResponseToKB` is the single owner), introduce hard exchange-count cutoffs, write `_system:settings.*` directly, read/write another plugin's settings, mount routes outside `/v1/plugins/<id>/`, modify files outside their own `plugins/<id>/` folder.
- **When changing the plugin contract:** bump `PLUGIN_API_VERSION` in `server/src/lib/plugins/version.js`, update `docs/plugins/plugin.schema.json` enums, `packages/plugin-sdk/index.d.ts`, and `docs/plugins/EXTENSION_REFERENCE.md`. `docs/plugins/CAPABILITIES.md` is the source of truth for documented vs. implemented.
- **Tests:** core plugin tests alongside each plugin (`plugins/<id>/server/*.test.js`); host tests at `server/tests/lib/plugins/*.test.js`.

## Development

```bash
cd client && npm install && cd ../server && npm install
cd server && cp .env.example .env   # add your Anthropic API key
node dev-sqlite.js
```

Client hot reload: `cd client && npm run dev` (port 5173, proxies API to :3000).

## Testing

```bash
cd server && npm test
```

AI route tests mock `ai-provider.js` (not `bedrock.js`). Run `npm test` before deploying.

## Deploy

Full procedure, SSM parameters, environments (prod / playground), CloudFront, and backups are in **[`docs/DEPLOY.md`](docs/DEPLOY.md)**. Automation (deploy dispatch, the agentic workflows, branch protection, versioning) is in **[`docs/AUTOMATION.md`](docs/AUTOMATION.md)**.

- Prod (`plato` stack) auto-deploys on push to `main`; playground (`plato-playground`) on push to `playground` — both via `repository_dispatch` to the private fork. Merges to `main` auto-deploy to prod with live users.
- CloudFront → Lambda Function URL: the Origin Request Policy **must** be `AllViewerExceptHostHeader` (Function URLs reject mismatched Host headers).
- The SAM build does not bundle the client — the `cp` steps for `client-dist` (SPA) and `client-content` (prompt seed files) are required; see `docs/DEPLOY.md`.

## Conventions

- **Accessibility is required**: every interactive element must be keyboard-operable and have an accessible name (aria-label, aria-pressed, role, etc.). Chat log uses `role="log"` `aria-live="off"`; new-message announcements go through a separate auto-clearing `role="status"` region; a streaming `AssistantMessage` is `aria-hidden` AND drops its `data-chat-message`/`tabIndex` so focus and Alt+Arrow nav can't land on an aria-hidden node; persisted messages carry sr-only speaker prefixes + `data-chat-message` for Alt+Arrow nav (`useChatKeyboardNav`). The inline `ComposeBar` (when pinned) is `inert`, not `aria-hidden`, so a focused control inside it is blurred rather than hidden-with-focus. `ComposeBar` sends on Cmd/Ctrl+Enter; plain Enter inserts a newline. `ComposeBar` sends on Cmd/Ctrl+Enter; plain Enter inserts a newline.
- **Always commit and push after changes.**
- **PR workflow for collaborative iteration**: open PRs as **Draft** (`gh pr create --draft`) while iterating interactively; mark Ready (`gh pr ready <n>`) only when the user says it's ready. If a Ready PR gets more iteration, convert it back (`gh pr ready <n> --undo`). Every push to a Ready PR triggers the full CI suite (Bedrock auto-review, CodeQL, lint ×2) — micro-commits there are noise and waste budget. Does NOT apply to plato-pilot PRs (opened Ready by design) or one-line bugfixes already approved up front.
- **Docs & tests**: update both alongside every code change (open-source project).
- Admin pages (`/plato/*`) are never themed with classroom branding. Auth pages use `usePublicBranding`; classroom pages use `BrandingProvider`. Admin nav order: Home, Lessons, Users, Customizer, Plugins (courses live inside Admin → Lessons).
- Footer text: "Powered by plato." (with period, with GitHub link). Emails use classroom name/colors from settings with that footer.
- API responses for user groups use `{ userGroups: [...] }` consistently. User-created lesson IDs start with `custom-`. `loadLessons()` merges system lessons (`/v1/lessons`) with user sync-data lessons.
- Favicon: defaults to plato's; generated dynamically (logo on rounded-rect with primary color) when an admin uploads a logo.

## Key files

- `server/template.yaml` — SAM/CloudFormation infrastructure
- `server/src/lib/email.js` — SES email templates (invite, reset)
- `server/src/lib/ai-provider.js` — AI abstraction (Bedrock or Anthropic API)
- `server/src/routes/sync.js` — sync CRUD + `applyActivityEffects` (denormalization single writer)
- `server/src/lib/lesson-limits.js` — server-side mirror of microlearning limits
- `server/src/lib/lesson-stats-cache.js` — stale-while-revalidate KPI cache
- `client/src/contexts/BrandingContext.jsx` — classroom branding for authenticated pages
- `client/src/hooks/usePublicBranding.js` — classroom branding for auth pages
- `client/src/lib/branding.js` — shared branding utilities (CSS vars, favicon gen)
- `client/src/lib/lessonEngine.js` — lesson runtime; `applyCoachResponseToKB` (completion semantics), `resumeLesson`, image hydration/migration
- `client/src/lib/lessonCreationEngine.js` — lesson creation flow; `buildConversationText`
- `client/js/lessonOwner.js` — lesson loading and markdown parsing
- `client/js/storage.js` — sync-data cache and persistence (`putSyncData`)
- `client/js/orchestrator.js` — AI agent orchestration
- `client/src/lib/imageCompression.js` — downscales pasted screenshots under the 400 KB item limit
- `client/src/lib/constants.js` — microlearning limits + shared constants
- `client/src/hooks/useChatKeyboardNav.js` — Alt+Arrow chat navigation
- `client/src/hooks/useTitleNotification.js` — document title flash for new-message notifications
- `client/src/pages/admin/UserStatsPanel.jsx` — per-user activity widget (Admin → Users)
- `client/src/pages/admin/CompletionRing.jsx` — SVG completion donut, color-coded

## Reference docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — subsystem deep-dives + incident history
- [`docs/AUTOMATION.md`](docs/AUTOMATION.md) — CI/CD, agentic workflows, branch protection, versioning
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — error-reporting tiers + how to add an alert
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — AWS deploy, environments, backups
- [`docs/plugins/`](docs/plugins/) — plugin authoring (human + AI guides, reference, examples)
