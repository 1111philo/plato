# Code Review Guidelines

Review instructions for the Claude GitHub App. These apply in addition to CLAUDE.md.

## Critical — always flag

- **Accessibility:** Every interactive element (button, input, link, toggle) must be keyboard-operable and have an accessible name (aria-label, role, etc.). Missing accessibility is a blocking issue.
- **Security:** No command injection, XSS, SQL injection, or secrets in code. Auth tokens only in `plato_auth` localStorage key.
- **Tests:** Server-side changes to routes or lib should have corresponding tests in `server/tests/`. Check that `npm test` would still pass.
- **Content change management:** Changes to files in `client/prompts/` or `client/data/` will surface as pending updates for admins on existing installs. This is expected — just note it in the review.
- **Live-user impact:** plato is deployed at learn.ai-leaders.org; merges to `main` auto-deploy to prod while learners are mid-lesson. Always surface changes to in-flight lesson state (`client/js/orchestrator.js`, `lessonOwner.js`, `storage.js`, `lessonEngine.js`), the streaming chat path (`server/src/routes/ai.js`, `ai-provider.js`), auth/JWT/refresh-token handling, DynamoDB schema / sync-data format, `server/template.yaml`, `client/prompts/*.md`, or microlearning constants — either as blocking (real risk) or as a user-impact note on an otherwise-clean approval. When reviewing a `plato-pilot` PR, cross-check the author's `User impact` claim against the diff; a mislabeled "low" on a higher-risk surface is a must-flag.
- **End every review body with a one-line `User impact:` summary.** Format: `User impact: none/low/medium/high — <one sentence>`. This gives the maintainer a consistent final signal before merge.

## Important — flag as suggestions

- **Docs:** Changes that affect architecture, features, or dev workflow should update CLAUDE.md, README.md, or CONTRIBUTING.md.
- **Admin pages** (`/plato/*`) must not use classroom branding (no BrandingProvider, no usePublicBranding).
- **Classroom pages** must use BrandingProvider context.
- **Auth pages** (login, signup, forgot-password, reset-password) must use usePublicBranding hook.
- **API consistency:** User group responses use `{ userGroups: [...] }`. Sync data uses optimistic locking via version field.

## Skip — do not flag

- Files in `dist/`, `.aws-sam/`, `node_modules/`
- Bundle size changes
- Minor style preferences (semicolons, trailing commas) — the project has no linter enforcing these
