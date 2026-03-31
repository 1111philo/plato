# plato

Exemplar-driven learning platform powered by AI. Learners work through courses in a continuous conversation with an AI coach that creates activities, evaluates submissions, and tracks progress toward mastery.

## Structure

```
client/     React 18 + Vite SPA
server/     Node.js + Hono + AWS Lambda + DynamoDB
scripts/    Build and deploy tooling
```

## Quick start (local dev)

```bash
# Install dependencies
cd client && npm install && cd ../server && npm install && cd ..

# Build the client
cd client && npm run build && cd ..

# Seed prompts, courses, and knowledge base
cd server && DB_BACKEND=sqlite SQLITE_PATH=./data/learn-service-dev.db node scripts/seed-content.js

# Start the server (SQLite, no Docker needed)
node dev-sqlite.js
```

Open http://localhost:3000. On first visit you'll create an admin account.

## Architecture

- **Login required** — all data is server-side, no local storage
- **6 AI agents** via Amazon Bedrock proxy: coach, course-owner, course-creator, course-extractor, learner-profile-owner, learner-profile-update
- **Admin dashboard** at `/plato-admin` for managing participants, courses, system prompts, theme, and knowledge base
- **Single-tenant** — one instance, global settings, multiple admins

### Client

React SPA with Vite. Auth pages (login, signup, forgot/reset password, first-time setup) are public. Everything else requires authentication. Admin pages are lazy-loaded and role-gated.

### Server

Hono framework on AWS Lambda with DynamoDB. Two Lambda functions: API Gateway (buffered) and Function URL (streaming SSE for AI responses). Local dev uses SQLite via `better-sqlite3`.

**Tables:** users, invites, refresh-tokens, sync-data, audit-log

Content (prompts, courses, knowledge base, theme) is stored in the sync-data table under the `_system` user.

## Deploy

```bash
cd server
sam build && sam deploy
```

Requires AWS SAM CLI and configured AWS credentials. See `server/template.yaml` for infrastructure and `server/samconfig.toml` for deploy config.

### SSM Parameters

| Parameter | Description |
|-----------|-------------|
| `/learn-service/jwt-secret` | JWT signing secret |
| `/learn-service/admin-email` | Bootstrap admin email (optional with setup UI) |
| `/learn-service/admin-password` | Bootstrap admin password (optional with setup UI) |
| `/learn-service/ses-from-email` | SES verified sender |
| `/learn-service/app-url` | Public URL for invite/reset links |

## License

See [LICENSE](client/LICENSE).
