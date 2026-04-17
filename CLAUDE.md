# CLAUDE.md

Project-level instructions for Claude Code sessions working on plato.

## Project overview

plato is an open-source, AI-powered [microlearning](https://philosophers.group/platos-microlearning/) platform. Learners work through focused lessons in a continuous conversation with an AI coach, designed for completion in ~20 minutes.

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
- Lesson visibility: lessons are either `public` (visible to all) or `private` (visible only to users in `sharedWith` array). Legacy `draft`/`published` statuses are auto-normalized to `private`/`public`.
- Lesson Catalog appended at runtime: public lessons for `PUBLIC_CATALOG_AGENTS` (coach), all lessons with `[PRIVATE]` tags for `ADMIN_CATALOG_AGENTS` (lesson-creator, knowledge-base-editor)
- Microlearning constraints defined in `client/src/lib/constants.js`: MAX_EXCHANGES=11, MIN_OBJECTIVES=2, MAX_OBJECTIVES=4. Server mirrors in `server/src/lib/lesson-limits.js`. Prompts reference these as literal numbers (update both if changed).
- Pacing: lessons target 11 exchanges (~20 min). **There is no hard cutoff** — lessons always run until the coach awards progress 10. The coach gets escalating `pacingDirective` nudges in the context JSON (at 8+, 11+, 15+, 20+) but these are suggestions, never orders. `client/src/lib/lessonEngine.js` must never auto-complete a lesson based on exchange count; only `parsed.progress >= 10` triggers completion. Philosophy: "move people, not force people" — the coach can always introduce new scaffolding if the learner needs it. `extendedLessons` (completions at 22+ exchanges) is informational only — it signals lesson-design mismatch, not a metric to drive to zero.
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched via `/v1/branding` (public, no auth)
- Admin dashboard at `/plato` (lazy-loaded, role-gated) with Lesson Pacing KPIs (on-target rate, over-target count, extended-lesson count)
- Server logging: `server/src/lib/logger.js` — ring-buffer logger keyed by snake_case `code` strings (not free-form messages). Each call mirrors a structured JSON line to stdout that includes `logId`, so Lambda → CloudWatch captures the same shape and the endpoint can dedupe events retrieved from both lanes. `GET /v1/admin/logs` merges the in-process buffer with CloudWatch (Lambda has `logs:FilterLogEvents` scoped to `/aws/lambda/${AWS::StackName}-*` plus `logs:DescribeLogGroups` on `*` since that action doesn't support per-group scoping). The log-group prefix for queries is derived from stage (prod → `/aws/lambda/plato-`, playground → `/aws/lambda/plato-playground-`) to match CloudFormation's naming — the prod stack is bare `plato`, not `plato-prod`. CloudWatch is queried with two required-term patterns (`ERROR` and `"Task timed out"`) — never the all-optional `?FOO ?BAR` form, which CloudWatch treats as match-everything. The pilot agent (via `scripts/pilot-report.js`) is the primary consumer: response is pre-aggregated into `groups` by code with counts, firstSeen/lastSeen, and a sample entry, and the pilot workflow itself no longer needs AWS credentials (no `AWS_ROLE_ARN` secret, no `aws-actions/configure-aws-credentials` step — all log reads are proxied through the endpoint via admin JWT). CloudWatch failures populate `cloudwatch.error` instead of silently returning empty.

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

124 tests. AI route tests mock `ai-provider.js` (not `bedrock.js`).

## Deploy to AWS

```bash
cd client && npm ci && npm run build
cd ../server && sam build
cp -r ../client/dist .aws-sam/build/PlatoStreamFunction/client-dist
cp -r ../client/dist .aws-sam/build/PlatoApiFunction/client-dist
mkdir -p .aws-sam/build/PlatoApiFunction/client-content .aws-sam/build/PlatoStreamFunction/client-content
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoApiFunction/client-content/
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoStreamFunction/client-content/
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
- Run `npm test` before deploying
- Version is tag-based (`Beta-RC-X`). On push to main, `.github/workflows/version-bump.yml` creates the next `Beta-RC-N` git tag + GitHub release. There's no `version.json` tracked in git — the deploy workflow generates it from the latest tag before packaging Lambda. Local dev: no version.json means the admin sidebar hides the version label; that's intentional.
- Deploy workflows live only in the private fork (UIC-OSF/learn.ai-leaders.org), not in the public repo. Deploys are automated via `repository_dispatch`: pushing to `main` here triggers `.github/workflows/trigger-deploy.yml`, which fires a `deploy-prod` dispatch to the private fork; pushing to `playground` fires `deploy-playground`. The private fork's `deploy.yml` / `deploy-playground.yml` listen for those events, check this repo out at the dispatched SHA, and run SAM deploy. No more pushing to the deploy remote. One-time setup: a `DEPLOY_DISPATCH_TOKEN` secret on this repo (fine-grained PAT with `contents:write` on the deploy fork). Manual deploy: run `Trigger Deploy` here via `workflow_dispatch` with a `target` input (`prod` / `playground` / `both` — `both` fires simultaneous deploys to both envs), or run `Deploy to AWS` / `Deploy to Playground` directly from the private fork's Actions tab with an optional `ref` input (branch/tag/SHA on this repo).
- `main` and `playground` are ruleset-protected (required PR + 1 approving review + passing `review` status check from the Code Review workflow; no force pushes; no deletion). Blake as repository admin is on the bypass list with `bypass_mode: always` for emergency overrides.
- Auto code review: `.github/workflows/code-review.yml` runs on every PR (opened + synchronize) and posts a review as `claude[bot]`. Reviews are per-commit idempotent: the guard step queries existing reviews and skips when a `claude[bot]` review already exists for the current head sha. New commits (different sha) — including `revise.yml`'s fixup pushes — still get reviewed. The job still completes when skipped so the required `review` status check is satisfied. The reviewer prompt explicitly instructs the agent to submit exactly ONE `gh pr review` call (the agent was previously double-posting inside a single run). Only one automated reviewer should be active at a time; if the hosted Claude GitHub App (github.com/apps/claude) is also installed with auto-review enabled, disable it there to prevent duplicate reviews.
- API responses for user groups use `{ userGroups: [...] }` consistently
- Emails use classroom name/colors from settings, with "Powered by plato." footer linking to GitHub
- Auth pages (login, signup, forgot-password, reset-password) use `usePublicBranding` hook for classroom theming
- Classroom pages use `BrandingProvider` context
- Admin pages (`/plato/*`) are never themed with classroom branding
- Footer text: "Powered by plato." (with period, with GitHub link)
- User-created lesson IDs start with `custom-`
- `loadLessons()` merges system lessons (`/v1/lessons`) with user lessons from sync-data
- Favicon: defaults to plato's; generated dynamically when admin uploads a logo image (logo on rounded-rect with primary color)
- Lesson visibility: new lessons default to private (shared only with author). Admins toggle public/private and manage shared users via the Share modal.
- No admin lesson preview — admins preview lessons by sharing with themselves and viewing in the classroom
- Lesson editing: conversation-based via the Lesson Creator agent (no raw markdown editor)
- Knowledge base: created/edited by admins via the KB Editor agent in the Customizer (not directly editable)
- Admin nav order: Home, Lessons, Users, Customizer, Integrations

## Key files

- `server/template.yaml` — SAM/CloudFormation infrastructure
- `server/src/lib/email.js` — SES email templates (invite, reset)
- `server/src/lib/ai-provider.js` — AI abstraction (Bedrock or Anthropic API)
- `client/src/contexts/BrandingContext.jsx` — classroom branding for authenticated pages
- `client/src/hooks/usePublicBranding.js` — classroom branding for auth pages
- `client/src/lib/branding.js` — shared branding utilities (CSS vars, favicon gen)
- `client/src/lib/lessonCreationEngine.js` — lesson creation conversation flow
- `client/js/lessonOwner.js` — lesson loading, parsing, KB management
- `client/js/storage.js` — sync-data cache and persistence
- `client/js/orchestrator.js` — AI agent orchestration
- `client/src/hooks/useChatKeyboardNav.js` — Alt+Arrow keyboard navigation between chat messages
- `client/src/hooks/useTitleNotification.js` — document title flash for new-message notifications
- `client/src/lib/constants.js` — microlearning limits (MAX_EXCHANGES, MIN/MAX_OBJECTIVES) and shared constants
- `server/src/lib/lesson-limits.js` — server-side mirror of microlearning limits
