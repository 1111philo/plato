# learn-service

Cloud user management and data sync for learn-extension. AWS Lambda + Hono + DynamoDB.

## Project overview

learn-service provides real user accounts (admins and participants), invite-based registration, and cloud data sync for the learn-extension Chrome extension. It enables cross-device data persistence so participants don't lose their learning progress when switching machines.

## Structure

```
src/
  index.js                  Lambda entry (Hono app, CORS, admin bootstrap)
  config.js                 Table names, JWT secret, env vars from SSM
  routes/
    health.js               GET /v1/health
    auth.js                 POST /v1/auth/{signup,login,refresh,logout}
    me.js                   GET/PATCH/DELETE /v1/me, GET /v1/me/export
    admin.js                GET/POST/DELETE /v1/admin/{participants,invites}
    sync.js                 GET/PUT/DELETE /v1/sync/{:dataKey,batch}
    ai.js                   POST /v1/ai/messages — Bedrock proxy (authenticated, supports SSE streaming)
    app.js                  GET / — inline HTML SPA (web frontend)
  middleware/
    authenticate.js         JWT verification → sets userId, role, user on context
    requireAdmin.js         Checks role === 'admin'
  lib/
    db.js                   DynamoDB operations for all 5 tables
    crypto.js               User ID, invite token, refresh token generation
    jwt.js                  JWT sign/verify via jose
    password.js             bcrypt hash/compare via bcryptjs
    email.js                SES invite email (reads SKIP_EMAIL from process.env)
    bedrock.js              Amazon Bedrock client wrapper (mockable for tests)
dev.js                      Local dev server (@hono/node-server)
scripts/
  setup-local-db.js         Creates DynamoDB tables on local DynamoDB instance
template.yaml               SAM infrastructure (Lambda, API Gateway, 5 DynamoDB tables)
samconfig.toml              SAM deploy config (stack: learn-service, region: us-east-2)
tests/                      Node.js test runner, mocks db.js exports directly
```

## Conventions

- Vanilla JS, ESM, no build step — matches learn-extension and learn-dashboard
- Two roles: `admin` and `participant`
- User IDs prefixed `usr_`, invite tokens `inv_`, refresh tokens `rt_`
- Auth: JWT access tokens (15 min) + refresh tokens (30 day, hashed in DynamoDB)
- Passwords hashed with bcrypt (cost 10)
- Invites: 7-day TTL, single-use, sent via SES
- Admin bootstrap: on first request, if no users and ADMIN_EMAIL+ADMIN_PASSWORD set, creates admin
- Tests mock db.js exports directly (mutable object pattern for ESM, same as learn-dashboard)
- Frontend: inline HTML served by routes/app.js, light theme matching learn-extension
- Local dev uses `dev.js` with `@hono/node-server` + DynamoDB Local (Docker)

## DynamoDB tables

- `learn-service-users` — PK: userId, GSI: email-index
- `learn-service-invites` — PK: inviteToken, GSI: email-index, TTL: ttl
- `learn-service-refresh-tokens` — PK: tokenHash, TTL: ttl
- `learn-service-sync-data` — PK: userId, SK: dataKey (profile, profileSummary, preferences, work, progress:*)
- `learn-service-audit-log` — PK: logId (records user deletions with action, userId, email, performedBy, details, createdAt)

## Sync data keys

| Key | Content |
|-----|---------|
| `profile` | Full AI-generated learner profile |
| `profileSummary` | Plain-text profile summary |
| `preferences` | User preferences (name) |
| `work` | Array of completed work products |
| `progress:{courseId}` | Per-course progress (learning plan, activities, drafts, scores) |

Screenshots (IndexedDB binary blobs) are not synced. The `VALID_DATA_KEYS` regex in `routes/sync.js` enforces this whitelist.

## AI proxy (Bedrock)

`POST /v1/ai/messages` proxies requests to Amazon Bedrock for authenticated users. The extension sends the same body format as the Anthropic Messages API (`{ model, max_tokens, system, messages }`). The route maps Anthropic model IDs to Bedrock model IDs.

When the request body includes `stream: true`, the response is an SSE stream (`text/event-stream`) that pipes Bedrock chunks directly to the client as `data: {json}\n\n` lines, ending with `data: [DONE]\n\n`. The extension must use the Lambda Function URL (not API Gateway) for streaming, since API Gateway buffers responses. The Function URL is configured with `InvokeMode: RESPONSE_STREAM` and the Lambda handler uses `streamHandle` from `hono/aws-lambda`.

Without `stream: true`, the response is standard JSON (same as before).

The Lambda IAM role has `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` permissions. The Bedrock client (`lib/bedrock.js`) exposes both `invoke()` (sync) and `invokeStream()` (async generator) methods.

Model mapping (in `routes/ai.js`):
- `claude-haiku-4-5-20251001` → `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- `claude-sonnet-4-6` → `us.anthropic.claude-sonnet-4-6`

## SSM parameters (production)

- `/learn-service/jwt-secret` — JWT signing secret
- `/learn-service/admin-email` — Bootstrap admin email
- `/learn-service/admin-password` — Bootstrap admin password
- `/learn-service/ses-from-email` — SES verified sender address
- `/learn-service/app-url` — Public URL for invite links

## Rules for every change

1. If adding or changing endpoints, update this CLAUDE.md and README.md.
2. If changing stored data shapes, update sync validation in `routes/sync.js` (VALID_DATA_KEYS).
3. If adding new DynamoDB operations, add them to `lib/db.js` and mock them in relevant tests.
4. Never log or store passwords in plaintext. Refresh tokens are stored as SHA-256 hashes.
5. Tests must pass (`npm test`) before committing.
6. The web frontend in `routes/app.js` must match the learn-extension visual style (CSS vars, 1111 logo, light theme).
7. Email templates use inline styles (no external CSS) for email client compatibility.
