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
- Content stored as `_system` sync-data: `prompt:*`, `course:*`, `knowledgeBase`, `settings`
- User-created courses stored under user's own sync-data: `courses:custom-*`
- 6 AI agents via Bedrock or Anthropic API: coach, course-owner, course-creator, course-extractor, learner-profile-owner, learner-profile-update
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched via `/v1/branding` (public, no auth)
- Admin dashboard at `/plato` (lazy-loaded, role-gated)

## Development

```bash
cd client && npm install && cd ../server && npm install
cd server && ANTHROPIC_API_KEY=sk-ant-... node dev-sqlite.js
```

Client hot reload: `cd client && npm run dev` (port 5173, proxies API to :3000)

## Testing

```bash
cd server && npm test
```

80 tests. AI route tests mock `ai-provider.js` (not `bedrock.js`).

## Deploy to AWS

```bash
cd client && npm ci && npm run build
cd ../server && sam build
cp -r ../client/dist .aws-sam/build/PlatoStreamFunction/client-dist
cp -r ../client/dist .aws-sam/build/PlatoApiFunction/client-dist
sam deploy
```

The client-dist copy step is required — SAM doesn't build the client. Without it, the Lambda serves "Client not built" instead of the SPA.

Deploy config: `server/samconfig.toml` (profile: dase, region: us-east-2, stack: plato).

SSM parameters: `/plato/jwt-secret`, `/plato/admin-email`, `/plato/admin-password`, `/plato/ses-from-email`, `/plato/app-url`

## CloudFront

The site is served via CloudFront -> Lambda Function URL. The Origin Request Policy **must** be `AllViewerExceptHostHeader` — Lambda Function URLs reject requests where the Host header doesn't match their domain.

## Conventions

- Always commit and push after changes
- Run `npm test` before deploying
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
