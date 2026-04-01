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
cd server && ANTHROPIC_API_KEY=sk-ant-your-key-here node dev-sqlite.js
```

Open [http://localhost:3000](http://localhost:3000).

On first visit you'll create an admin account. Prompts, courses, and the knowledge base are seeded automatically.

### AI provider

plato needs access to Claude models. Set one of these:

| Option | Env var | Best for |
|--------|---------|----------|
| **Anthropic API** (recommended) | `ANTHROPIC_API_KEY=sk-ant-...` | Local dev, small deployments |
| **Amazon Bedrock** | AWS credentials + `AI_PROVIDER=bedrock` | Production on AWS |

The Anthropic API key is the easiest way to get started. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys).

If `ANTHROPIC_API_KEY` is set, plato uses it automatically. For Bedrock, set `AI_PROVIDER=bedrock` and configure AWS credentials.

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
- An AWS account with permissions for Lambda, DynamoDB, API Gateway, IAM, S3, and SES
- A verified SES sender email/domain
- An Anthropic API key or Amazon Bedrock access

### 1. SSM parameters

Create these in AWS Systems Manager Parameter Store before deploying:

| Parameter | Type | Description |
|-----------|------|-------------|
| `/plato/jwt-secret` | SecureString | JWT signing secret |
| `/plato/ses-from-email` | String | Verified SES sender email |
| `/plato/app-url` | String | Public URL (for invite/reset links) |
| `/plato/admin-email` | String | Bootstrap admin email (optional — setup UI handles this) |
| `/plato/admin-password` | SecureString | Bootstrap admin password (optional) |

### 2. Configure SAM

Copy the example config and customize it for your AWS account:

```bash
cd server
cp samconfig.toml.example samconfig.toml
# Edit samconfig.toml — set your region, stack name, and AWS profile
```

`samconfig.toml` is gitignored so your local config stays out of version control.

### 3. Deploy manually

```bash
# Build client
cd client && npm ci && npm run build && cd ..

# Build server
cd server && sam build

# Bundle client SPA into Lambda artifacts
cp -r ../client/dist .aws-sam/build/PlatoStreamFunction/client-dist
cp -r ../client/dist .aws-sam/build/PlatoApiFunction/client-dist

# Bundle content source files (prompts, courses, KB) for seeding and change management
mkdir -p .aws-sam/build/PlatoApiFunction/client-content .aws-sam/build/PlatoStreamFunction/client-content
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoApiFunction/client-content/
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoStreamFunction/client-content/

# Deploy
sam deploy
```

See `server/template.yaml` for the full infrastructure definition.

### 4. Set up CI/CD (recommended)

For production deployments, we recommend automating deploys from a **private fork** via GitHub Actions. This keeps your AWS credentials and deploy config separate from the public repo.

**Create a private fork:**

```bash
gh repo fork 1111philo/plato --fork-name my-plato --org my-org --clone=false
gh repo edit my-org/my-plato --visibility private --accept-visibility-change-consequences
```

**Set up OIDC authentication** (no static AWS keys needed):

1. Ensure your AWS account has a GitHub OIDC provider (one-time setup):
   ```bash
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com \
     --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
   ```

2. Create an IAM role that GitHub Actions can assume. The trust policy should allow your private fork repo:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": {
         "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
       },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
         "StringLike": { "token.actions.githubusercontent.com:sub": "repo:my-org/my-plato:*" }
       }
     }]
   }
   ```

3. Attach a permissions policy to the role with access to CloudFormation, Lambda, S3, API Gateway, DynamoDB, IAM (for role creation), and SSM (parameter reads).

**Add a deploy workflow** to your private fork at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to AWS

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: cd server && npm ci && npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: aws-actions/setup-sam@v2
        with:
          use-installer: true
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_DEPLOY_ROLE
          aws-region: YOUR_REGION
      - run: cd client && npm ci && npm run build
      - run: cd server && sam build
      - run: |
          cp -r client/dist server/.aws-sam/build/PlatoApiFunction/client-dist
          cp -r client/dist server/.aws-sam/build/PlatoStreamFunction/client-dist
      - run: |
          mkdir -p server/.aws-sam/build/PlatoApiFunction/client-content server/.aws-sam/build/PlatoStreamFunction/client-content
          cp -r client/prompts client/data server/.aws-sam/build/PlatoApiFunction/client-content/
          cp -r client/prompts client/data server/.aws-sam/build/PlatoStreamFunction/client-content/
      - run: >
          cd server && sam deploy
          --config-env ci
          --stack-name plato
          --region YOUR_REGION
          --s3-bucket YOUR_SAM_S3_BUCKET
          --s3-prefix plato
          --capabilities CAPABILITY_IAM
          --no-confirm-changeset
          --no-fail-on-empty-changeset
```

Replace `YOUR_ACCOUNT_ID`, `YOUR_DEPLOY_ROLE`, `YOUR_REGION`, and `YOUR_SAM_S3_BUCKET` with your values. The S3 bucket is the one SAM creates on first manual deploy (named `aws-sam-cli-managed-default-samclisourcebucket-*`).

**Workflow:** Push changes to the public repo (`origin`), then sync to your private fork (`deploy`) which triggers the CI/CD pipeline. Tests run first — deploy only happens if they pass.

### Custom domain (optional)

To serve the app from a custom domain:

1. Create a CloudFront distribution with the Lambda Function URL as a **Custom Origin** (HTTPS-only)
2. Set the Origin Request Policy to **AllViewerExceptHostHeader** (required for Lambda Function URLs)
3. Set the Cache Policy to **CachingDisabled** (the Lambda handles caching headers)
4. Add your domain as a CloudFront alternate domain name and attach an ACM certificate (must be in us-east-1)
5. Point your DNS (CNAME or alias) to the CloudFront distribution domain

## Versioning

plato uses a `Beta-RC-X` version scheme stored in `version.json`. The version is bumped automatically when a PR is merged to main via the `version-bump.yml` GitHub Action. The current version is displayed in the admin sidebar with a link to the GitHub repo.

The `main` branch is protected — all changes require a pull request.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, guidelines, and how to submit changes.

## License

Copyright (C) 2026 [11:11 Philosopher's Group](https://github.com/1111philo)

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License v3.0](LICENSE) as published by the Free Software Foundation.

This means you're free to use, modify, and distribute this software, but any modified version that's accessible over a network must also be made available under the same license. See the [LICENSE](LICENSE) file for details.
