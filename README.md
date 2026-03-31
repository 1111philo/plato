<p align="center">
  <img src="client/assets/plato-square.png" alt="plato" width="120" />
</p>

# plato

An open-source, exemplar-driven learning platform powered by AI. Learners work through courses in a continuous conversation with an AI coach that creates activities, evaluates submissions, and tracks progress toward mastery.

Built by [11:11 Philosopher's Group](https://github.com/1111philo).

Special thanks to [UIC Tech Solutions](https://it.uic.edu/), [UIC TS Open Source Fund](https://osf.it.uic.edu/), [WordPress](https://wordpress.org/), [Louisiana Tech](https://www.latech.edu/), and the [ULL Louisiana Educate Program](https://louisiana.edu/educate).

## How it works

A **course** defines an exemplar (the mastery-level outcome a learner is working toward) and a set of learning objectives. When a learner starts a course, an AI coach opens a conversation and guides them through activities — coaching, creating tasks, evaluating submissions (text or images), and tracking progress — all in a single continuous chat. The coach enriches a knowledge base as the learner progresses, adapting to their strengths and weaknesses until they achieve the exemplar.

Admins manage everything from `/plato`: users, courses, system prompts, a program knowledge base, and visual theming.

## Repository structure

```
plato/
  client/       React 18 + Vite SPA (the learner and admin UI)
  server/       Node.js + Hono + AWS Lambda + DynamoDB (API, auth, data, AI proxy)
  scripts/      Build and deploy tooling
```

## Quick start

### Prerequisites

- Node.js 20+
- npm

### Setup and run

```bash
# Clone the repo
git clone https://github.com/1111philo/plato.git
cd plato

# Install dependencies (client and server)
cd client && npm install && cd ../server && npm install && cd ..

# Build the client (server serves the built files)
cd client && npm run build && cd ..

# Start the dev server (uses SQLite — no Docker or AWS needed)
cd server && node dev-sqlite.js
```

Open [http://localhost:3000](http://localhost:3000).

On first visit you'll create an admin account. After that, seed the prompts, courses, and knowledge base:

```bash
# In a separate terminal
cd server
DB_BACKEND=sqlite SQLITE_PATH=./data/plato-dev.db node scripts/seed-content.js
```

Then log in and navigate to `/plato` to see the admin dashboard, or `/courses` to start learning.

### Development workflow

For client changes with hot reload:

```bash
cd client && npm run dev    # Vite dev server on :5173
```

For server changes (restart required):

```bash
cd server && node dev-sqlite.js    # API server on :3000
```

When developing the client with Vite's dev server, API calls go to `localhost:3000` — configure your browser or use a proxy.

> **AI features** require the server to proxy to Amazon Bedrock. Without it, the app is fully navigable but course conversations won't work.

## Architecture

### Overview

- **Login required** — all data is server-side, no browser storage beyond auth tokens
- **6 AI agents** via Amazon Bedrock: coach, course-owner, course-creator, course-extractor, learner-profile-owner, learner-profile-update
- **Admin dashboard** at `/plato` — manage users, courses, system prompts, knowledge base, and theme
- **Single-tenant** — one instance per deployment, global settings, multiple admins

### Client

React SPA built with Vite. Key areas:

| Directory | Purpose |
|-----------|---------|
| `src/pages/` | Route-level components (courses, settings, login, admin) |
| `src/components/` | Shared UI (AppShell, chat, modals) |
| `src/contexts/` | React contexts (auth, app state, modals) |
| `src/lib/` | Engines (course loop, course creation, profile queue, sync) |
| `js/` | Service modules (storage, orchestrator, auth, API, course parsing, validators) |

Admin pages under `src/pages/admin/` are lazy-loaded and role-gated.

### Server

Hono framework on AWS Lambda with DynamoDB (or SQLite for local dev). Two Lambda functions handle requests:

- **API Gateway** — buffered responses for CRUD operations
- **Function URL** — streaming SSE for AI chat responses

**DynamoDB tables:** users, invites, refresh-tokens, sync-data, audit-log

All content (system prompts, courses, knowledge base, theme/branding) is stored in the sync-data table under a `_system` user — no additional tables needed.

**Auth:** JWT access tokens (15 min) + refresh tokens (30 day, rotated). Invite-based registration. First-time setup creates the initial admin via a UI flow.

### AI agents

| Agent | Role |
|-------|------|
| **Coach** | Learner's companion in one continuous conversation — coaches, creates activities, evaluates submissions, tracks progress |
| **Course Owner** | Initializes a course knowledge base from the course prompt + learner profile |
| **Course Creator** | Guides users through designing custom courses via chat |
| **Course Extractor** | Extracts course markdown from a creation conversation |
| **Learner Profile Owner** | Deep profile update on course completion |
| **Learner Profile Update** | Incremental profile update from feedback/observations |

System prompts are stored in the database and editable by admins at `/plato/prompts`. Changes take effect immediately.

## Deploying to AWS

### Prerequisites

- AWS SAM CLI
- AWS credentials with permissions for Lambda, DynamoDB, SES, Bedrock
- A verified SES sender email/domain

### SSM parameters

Create these in AWS Systems Manager Parameter Store before deploying:

| Parameter | Type | Description |
|-----------|------|-------------|
| `/plato/jwt-secret` | SecureString | JWT signing secret |
| `/plato/ses-from-email` | String | Verified SES sender email |
| `/plato/app-url` | String | Public URL (for invite/reset links) |
| `/plato/admin-email` | String | Bootstrap admin email (optional — setup UI handles this) |
| `/plato/admin-password` | SecureString | Bootstrap admin password (optional) |

### Deploy

```bash
# Build client
cd client && npm ci && npm run build && cd ..

# Build and deploy server
cd server && sam build && sam deploy
```

See `server/template.yaml` for the full infrastructure definition and `server/samconfig.toml` for deploy config (stack: `plato`, region: `us-east-2`).

After deploying, run the seed script against DynamoDB to populate prompts and courses.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, guidelines, and how to submit changes.

## License

Copyright (C) 2026 [11:11 Philosopher's Group](https://github.com/1111philo)

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License v3.0](LICENSE) as published by the Free Software Foundation.

This means you're free to use, modify, and distribute this software, but any modified version that's accessible over a network must also be made available under the same license. See the [LICENSE](LICENSE) file for details.
