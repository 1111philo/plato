# Contributing to Learn Service

This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo).

## Getting started

1. Clone the repository.
2. Install dependencies: `npm install`
3. Start DynamoDB Local: `docker run -p 8000:8000 amazon/dynamodb-local`
4. Create local tables: `npm run setup-db`
5. Start the dev server: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=changeme npm run dev`
6. Open http://localhost:3000

## Development workflow

- All source is vanilla JS (ES modules) with no build step — matches the learn-extension and learn-dashboard repos.
- The dev server (`dev.js`) uses `@hono/node-server` to run the Hono app directly, pointing at DynamoDB Local on port 8000.
- Email sending is skipped locally by default (`SKIP_EMAIL=true`). Invite links are logged to the console.
- The web frontend is served as inline HTML from `src/routes/app.js` — no separate static files.

## Architecture

Two user roles drive the application:

- **Admins** manage participants, send invites, and assign Claude API keys.
- **Participants** sign up via invite, manage their profile, and sync data from the learn-extension.

Auth uses JWT access tokens (15 min) with rotating refresh tokens (30 days). Passwords are hashed with bcrypt (cost 12). Invite tokens are single-use with a 7-day TTL.

See `CLAUDE.md` for a full architecture reference including file structure, DynamoDB tables, and conventions.

## Running tests

Tests use Node's built-in test runner and mock the `db.js` default export directly (mutable object pattern for ESM):

```bash
npm test
```

All 36 tests must pass before committing.

## Guidelines

- **Match the learn-extension style.** The web frontend uses the same CSS variables, 1111 logo, and visual design.
- **Keep it lightweight.** No frameworks, no heavy dependencies.
- **Update docs.** If your change adds or changes endpoints, update `CLAUDE.md` and `README.md`.
- **Never commit secrets.** API keys, passwords, and JWT secrets come from environment variables or SSM.
- **Test locally.** Run the full flow (login → invite → signup → profile edit) against DynamoDB Local before pushing.

## Submitting changes

1. Create a branch from `main`.
2. Make focused, well-described commits.
3. Run `npm test` and verify all tests pass.
4. Open a pull request with a clear summary of what changed and why.

## Copyright

Copyright 11:11 Philosopher's Group. All rights reserved.
