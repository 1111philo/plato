# Releases and CI/CD

## Branch workflow

All changes flow: **feature branches → staging → main**.

`main` is protected: direct pushes are blocked, PRs require approval and passing status checks. By convention, `main` only accepts PRs from `staging`. Branch protection is configured via `scripts/setup-branch-protection.sh`.

## Staging (release candidates)

Every push to `staging` triggers `.github/workflows/staging.yml`:

1. Runs tests (`npm test`) and builds (`npm run build`)
2. Counts non-bump commits since staging diverged from main to determine the RC number
3. Generates release notes via Claude (Haiku)
4. Creates a GitHub **pre-release** tag (e.g., `v1.3.0-RC5`)

RC builds are for tracking changes only — the web app deploys from `main`.

## Production (main)

When a PR from `staging` is merged into `main`, two workflows run:

**`.github/workflows/release.yml`** — runs tests, calls Claude (Haiku) for semver bump and release notes, creates a GitHub Release tag.

**`.github/workflows/deploy-web.yml`** — builds the app and deploys to GitHub Pages at `learn.philosophers.group`.

## Deployment

The app is a static site deployed to GitHub Pages with a custom domain:

- **URL:** https://learn.philosophers.group
- **Hosting:** GitHub Pages (free, automatic)
- **Build:** `npm run build` → `dist/`
- **CNAME:** `CNAME` file in repo root maps the custom domain

## Required secrets

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Claude-powered version analysis in release workflows |

## Host permissions

The app makes client-side API calls to:

| Host | Why |
|------|-----|
| `https://api.anthropic.com/*` | Claude API calls with the user's own key |
| `https://account.philosophers.group/*` | Cloud sync and authentication (optional) |

## Course prompt format

Courses are defined as markdown files in `data/courses/` (e.g., `foundations.md`). Each file follows this structure:

```markdown
# Course Title

One-line course description.

## Exemplar
A description of what the mastery-level outcome looks like.
Multiple lines are fine.

## Learning Objectives
- Can do X
- Can explain Y
- Can identify Z
```

To add a new course, create a `.md` file in `data/courses/`. The build-time manifest plugin auto-discovers all `.md` files in the directory.
