# CLAUDE.md

Project-level instructions for Claude Code sessions working on plato.

## Project overview

plato is an open-source, AI-powered [microlearning](https://philosophers.group/platos-microlearning/) platform. Learners work through focused lessons in a continuous conversation with an AI coach, designed for completion in ~20 minutes.

- `client/` — React 18 + Vite SPA
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
- Lesson Catalog appended at runtime: published-only for `PUBLISHED_CATALOG_AGENTS` (coach), full list with draft status for `ADMIN_CATALOG_AGENTS` (lesson-creator, knowledge-base-editor)
- Microlearning constraints defined in `client/src/lib/constants.js`: MAX_EXCHANGES=11, MIN_OBJECTIVES=2, MAX_OBJECTIVES=4. Server mirrors in `server/src/lib/lesson-limits.js`. Prompts reference these as literal numbers (update both if changed).
- Pacing: lessons target 11 exchanges (~20 min). No hard cutoff — coach gets escalating `pacingDirective` in context JSON at 11+, 15+, 20+ exchanges. Hard limit at 2x target (22) as safety net.
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched via `/v1/branding` (public, no auth)
- Admin dashboard at `/plato` (lazy-loaded, role-gated) with Lesson Pacing KPIs (on-target rate, over-target count, hard-limit hits)

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

85 tests. AI route tests mock `ai-provider.js` (not `bedrock.js`).

## Deploy to AWS

```bash
cd client && npm ci && npm run build
cd ../server && sam build
cp -r ../client/dist .aws-sam/build/PlatoStreamFunction/client-dist
cp -r ../client/dist .aws-sam/build/PlatoApiFunction/client-dist
mkdir -p .aws-sam/build/PlatoApiFunction/client-content .aws-sam/build/PlatoStreamFunction/client-content
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoApiFunction/client-content/
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoStreamFunction/client-content/
cp ../version.json .aws-sam/build/PlatoApiFunction/
cp ../version.json .aws-sam/build/PlatoStreamFunction/
sam deploy
```

The copy steps are required — SAM doesn't build the client. `client-dist` serves the SPA; `client-content` provides prompt and lesson source files for seeding.

Deploy config: `server/samconfig.toml` (copy from `samconfig.toml.example`, gitignored). See README.md for full deploy guide including CI/CD setup.

### Environments

The `template.yaml` accepts a `Stage` parameter (`prod` or `playground`). Each stage gets its own DynamoDB tables and SSM parameters:

- **prod** (`plato` stack) — learn.ai-leaders.org, deploys on push to `main`
- **playground** (`plato-playground` stack) — playground.ai-leaders.org, deploys on push to `playground`

SSM parameters (per stage): `/plato/{stage}/jwt-secret`, `/plato/{stage}/admin-email`, `/plato/{stage}/admin-password`, `/plato/{stage}/ses-from-email`, `/plato/{stage}/app-url`

### Backups

Prod DynamoDB tables have two backup layers:

- **PITR** (Point-in-Time Recovery) — continuous, restores to any second in the last 35 days
- **Pre-deploy snapshots** — the prod deploy workflow creates on-demand backups of all 5 tables before each deploy, keeping the last 5 per table

## CloudFront

The site is served via CloudFront -> Lambda Function URL. The Origin Request Policy **must** be `AllViewerExceptHostHeader` — Lambda Function URLs reject requests where the Host header doesn't match their domain.

## Conventions

- Accessibility is required: every interactive element must be keyboard-operable and have an accessible name (aria-label, aria-pressed, role, etc.)
- Always commit and push after changes
- Run `npm test` before deploying
- Version in `version.json` (Beta-RC-X format) — auto-bumped by GitHub Action on push to main
- Deploy workflow lives only in the private fork (UIC-OSF/learn.ai-leaders.org), not in the public repo
- API responses for user groups use `{ userGroups: [...] }` consistently
- Emails use classroom name/colors from settings, with "Powered by plato." footer linking to GitHub
- Auth pages (login, signup, forgot-password, reset-password) use `usePublicBranding` hook for classroom theming
- Classroom pages use `BrandingProvider` context
- Admin pages (`/plato/*`) are never themed with classroom branding
- Footer text: "Powered by plato." (with period, with GitHub link)
- User-created lesson IDs start with `custom-`
- `loadLessons()` merges system lessons (`/v1/lessons`) with user lessons from sync-data
- Favicon: defaults to plato's; generated dynamically when admin uploads a logo image (logo on rounded-rect with primary color)
- Lesson drafts: admins can save lessons as drafts (hidden from learners), preview in sandbox mode, then publish
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
- `client/src/lib/constants.js` — microlearning limits (MAX_EXCHANGES, MIN/MAX_OBJECTIVES) and shared constants
- `server/src/lib/lesson-limits.js` — server-side mirror of microlearning limits
- `version.json` — current version (Beta-RC-X), auto-bumped on PR merge
