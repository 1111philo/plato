# Learn Service

Cloud user management and data sync service for [1111 Learn](https://github.com/1111philo/learn-extension). Provides admin tools for managing participants and API keys, invite-only signup, and cross-device data persistence for the Chrome extension.

## Features

- **Admin dashboard** — manage participants, send email invites, assign Claude API keys
- **Participant accounts** — invite-only signup, profile management
- **Data sync** — cloud persistence for learn-extension data across devices
- **JWT auth** — secure access and refresh token flow

## Tech stack

- Node.js 20 + [Hono](https://hono.dev) (HTTP framework)
- AWS Lambda + API Gateway + DynamoDB + SES
- AWS SAM for infrastructure-as-code
- ESM, vanilla JS, no build step

## Quick start (local development)

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://www.docker.com/) (for DynamoDB Local)

### 1. Install dependencies

```bash
npm install
```

### 2. Start DynamoDB Local

```bash
docker run -d -p 8000:8000 amazon/dynamodb-local
```

### 3. Create local tables

```bash
npm run setup-db
```

> **Note:** DynamoDB Local stores data in memory by default. If the Docker container restarts, you need to run `npm run setup-db` again to recreate the tables.

### 4. Start the dev server

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=changeme npm run dev
```

Open **http://localhost:3000** — log in with the email and password above. The admin account is auto-created on first request.

Invite links are logged to the console (email sending is skipped locally). To enable real SES emails, unset `SKIP_EMAIL`:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=changeme SKIP_EMAIL=false SES_FROM_EMAIL=noreply@example.com npm run dev
```

### 5. Run tests

```bash
npm test
```

## Architecture

### User roles

| Role | Can do |
|------|--------|
| **Admin** | View participants, send invites, assign Claude API keys, remove participants |
| **Participant** | Sign up (invite-only), log in, edit profile, export data, delete account |

### Auth flow

1. Admin creates an invite → email sent with signup link
2. Participant signs up using the invite token → receives JWT access token + refresh token
3. Access tokens expire after 15 minutes; refresh tokens last 30 days and rotate on use
4. Extension authenticates with the same JWT tokens for data sync

### Data sync

The extension syncs these data types to the cloud:

| `dataKey` | Description |
|-----------|-------------|
| `profile` | Learner profile (AI-generated) |
| `profileSummary` | Plain-text profile summary |
| `preferences` | User preferences (name) |
| `work` | Completed work products |
| `progress:{courseId}` | Per-course progress |

Sync uses optimistic locking (version numbers) to handle conflicts. When a version mismatch occurs, the API returns `409` with the server's current version so the client can resolve.

### Admin bootstrap

On the very first request, if no users exist and `ADMIN_EMAIL` + `ADMIN_PASSWORD` environment variables are set, the service auto-creates an admin account. This avoids needing a separate seed script.

## API reference

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/health` | Health check |
| `POST` | `/v1/auth/signup` | Sign up with invite token |
| `POST` | `/v1/auth/login` | Log in → access + refresh tokens |
| `POST` | `/v1/auth/refresh` | Exchange refresh token for new access token |
| `POST` | `/v1/auth/logout` | Revoke refresh token |

### Authenticated (any role)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/me` | Get own profile |
| `PATCH` | `/v1/me` | Update name, email, affiliation, or password |
| `DELETE` | `/v1/me` | Delete account and all data (requires `{ "confirm": "DELETE" }`) |
| `GET` | `/v1/me/export` | Download all user data as JSON |
| `GET` | `/v1/sync` | Get all synced data |
| `GET` | `/v1/sync/:dataKey` | Get specific synced item |
| `PUT` | `/v1/sync/:dataKey` | Upsert data (with version for conflict detection) |
| `PUT` | `/v1/sync/batch` | Batch upsert (max 25 items) |
| `DELETE` | `/v1/sync/:dataKey` | Delete synced item |

### Admin only

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/admin/participants` | List all participants |
| `GET` | `/v1/admin/participants/:userId` | Get participant detail |
| `POST` | `/v1/admin/invites` | Create invite and send email |
| `GET` | `/v1/admin/invites` | List all invites |
| `DELETE` | `/v1/admin/invites/:token` | Revoke a pending invite |
| `DELETE` | `/v1/admin/participants/:userId` | Remove participant |

### Web frontend

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Web app (login, signup, admin dashboard, participant profile) |

## Project structure

```
learn-service/
├── dev.js                        # Local dev server (Node.js + Hono)
├── package.json
├── template.yaml                 # SAM infrastructure (Lambda, DynamoDB, API Gateway)
├── samconfig.toml                # SAM deploy config
├── scripts/
│   └── setup-local-db.js         # Create DynamoDB tables locally
├── src/
│   ├── index.js                  # Lambda entry point, CORS, admin bootstrap
│   ├── config.js                 # Environment variables, constants
│   ├── routes/
│   │   ├── health.js             # GET /v1/health
│   │   ├── auth.js               # Signup, login, refresh, logout
│   │   ├── me.js                 # Profile view/edit, API key retrieval
│   │   ├── admin.js              # Participant + invite management
│   │   ├── sync.js               # Data sync CRUD with optimistic locking
│   │   └── app.js                # Web frontend (inline HTML SPA)
│   ├── middleware/
│   │   ├── authenticate.js       # JWT verification → userId, role, user
│   │   └── requireAdmin.js       # Admin role guard
│   └── lib/
│       ├── db.js                 # All DynamoDB operations
│       ├── crypto.js             # Token/ID generation
│       ├── jwt.js                # JWT sign/verify (jose)
│       ├── password.js           # bcrypt hash/compare
│       └── email.js              # SES invite email
└── tests/
    ├── lib/
    │   ├── jwt.test.js
    │   └── password.test.js
    └── routes/
        ├── auth.test.js
        ├── me.test.js
        ├── sync.test.js
        └── admin.test.js
```

## DynamoDB tables

| Table | Key | GSI | TTL |
|-------|-----|-----|-----|
| `learn-service-users` | PK: `userId` | `email-index` | — |
| `learn-service-invites` | PK: `inviteToken` | `email-index` | `ttl` (7 days) |
| `learn-service-refresh-tokens` | PK: `tokenHash` | — | `ttl` (30 days) |
| `learn-service-sync-data` | PK: `userId`, SK: `dataKey` | — | — |
| `learn-service-audit-log` | PK: `logId` | — | — |

## Deploy to AWS

### One-time setup: SSM parameters

```bash
aws ssm put-parameter --name /learn-service/jwt-secret --value "YOUR_SECRET" --type SecureString
aws ssm put-parameter --name /learn-service/admin-email --value "admin@example.com" --type String
aws ssm put-parameter --name /learn-service/admin-password --value "YOUR_PASSWORD" --type SecureString
aws ssm put-parameter --name /learn-service/ses-from-email --value "noreply@philosophers.group" --type String
aws ssm put-parameter --name /learn-service/app-url --value "https://account.philosophers.group" --type String
```

### One-time setup: Verify SES sender

Verify the sending email address or domain in the [AWS SES console](https://console.aws.amazon.com/ses/) before sending invite emails.

### Deploy

```bash
sam build && sam deploy
```

The API URL is printed in the stack outputs after deploy.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_EMAIL` | Bootstrap admin email | — |
| `ADMIN_PASSWORD` | Bootstrap admin password | — |
| `JWT_SECRET` | JWT signing secret | `dev-secret-change-me` |
| `SES_FROM_EMAIL` | Verified SES sender address | — |
| `APP_URL` | Public URL (used in invite links) | `http://localhost:3000` |
| `SKIP_EMAIL` | Set `true` to log invite links instead of sending email | — |
| `DYNAMODB_ENDPOINT` | Local DynamoDB URL (dev only) | — |

## Copyright

Copyright 11:11 Philosopher's Group. All rights reserved.
