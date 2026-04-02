# CLAUDE.md

Project-level instructions for Claude Code sessions working on plato.

## Project overview

plato is an open-source, AI-powered learning platform. Learners work through courses in a continuous conversation with an AI coach.

- `client/` — React 18 + Vite SPA
- `server/` — Node.js + Hono, deployed as AWS Lambda (SAM)
- Brand: "plato" (always lowercase)

## Architecture

- Login required — all data server-side, no offline mode
- Auth: JWT access tokens (15 min) + refresh tokens (30 day), stored in localStorage (`plato_auth`). Login accepts email or username
- Users have a unique `username` (auto-generated if not set, editable, 3-30 chars alphanumeric/hyphens/underscores)
- 2 Lambda functions: API Gateway (buffered CRUD) + Function URL (streaming SSE for AI chat)
- 5 DynamoDB tables: users, invites, refresh-tokens, sync-data, audit-log
- Content stored as `_system` sync-data: `prompt:*`, `course:*`, `knowledgeBase`, `settings` — each record includes a `bundledHash` for change management
- Content change management: when bundled files (`client/prompts/`, `client/data/`) differ from DB, admins see an alert on the dashboard and can accept or dismiss each update
- User-created courses stored under user's own sync-data: `courses:custom-*`
- 6 AI agents via Bedrock or Anthropic API: coach, course-owner, course-creator, course-extractor, learner-profile-owner, learner-profile-update
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched via `/v1/branding` (public, no auth)
- Admin dashboard at `/plato` (lazy-loaded, role-gated)

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

93 tests. AI route tests mock `ai-provider.js` (not `bedrock.js`).

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

The copy steps are required — SAM doesn't build the client. `client-dist` serves the SPA; `client-content` provides prompt/course/KB source files for seeding and content change management.

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
- User-created course IDs start with `custom-`
- `loadCourses()` merges system courses (`/v1/courses`) with user courses from sync-data
- Favicon is generated dynamically via canvas: classroom logo on rounded-rect with primary color background

## Key files

- `server/template.yaml` — SAM/CloudFormation infrastructure
- `server/src/lib/email.js` — SES email templates (invite, reset)
- `server/src/lib/ai-provider.js` — AI abstraction (Bedrock or Anthropic API)
- `client/src/contexts/BrandingContext.jsx` — classroom branding for authenticated pages
- `client/src/hooks/usePublicBranding.js` — classroom branding for auth pages
- `client/src/lib/branding.js` — shared branding utilities (CSS vars, favicon gen)
- `client/src/lib/courseCreationEngine.js` — course creation conversation flow
- `client/js/courseOwner.js` — course loading, parsing, KB management
- `client/js/storage.js` — sync-data cache and persistence
- `client/js/orchestrator.js` — AI agent orchestration
- `server/src/lib/content-updates.js` — content change detection (hash comparison, bundled file reading)
- `client/src/pages/admin/AdminContentUpdates.jsx` — admin review page for upstream content changes
- `version.json` — current version (Beta-RC-X), auto-bumped on PR merge
