# plato Automation — CI/CD & agentic workflows

How plato's GitHub Actions ecosystem works: the agentic workflows (pilot,
intake, review, revise), the data-loss alarm, deploy dispatch, branch
protection, and versioning. For the *error-reporting* side of monitoring (tiers,
how to add a detector), see [`OBSERVABILITY.md`](OBSERVABILITY.md) — this doc
does not repeat it.

## Claude workflow auth (Bedrock OIDC)

`pilot.yml`, `code-review.yml`, `issue-intake.yml`, and `revise.yml` all use
**AWS Bedrock via OIDC**. Each job has `id-token: write`, runs
`aws-actions/configure-aws-credentials@v4` to assume
`${{ secrets.AWS_BEDROCK_ROLE_ARN }}` in `us-east-2`, then passes
`use_bedrock: "true"` to `anthropics/claude-code-action@v1`. Models are pinned
via `--model` in `claude_args` to Bedrock cross-region inference profiles:
`us.anthropic.claude-sonnet-4-5-20250929-v1:0` for review/pilot,
`us.anthropic.claude-haiku-4-5-20251001-v1:0` for intake/revise. The role is
`arn:aws:iam::722741357267:role/plato-github-bedrock` (separate AWS account from
prod plato). Bedrock cross-region inference profiles route across
us-east-1/us-east-2/us-west-2, so model access must be granted in all three
regions on the role's account. No `ANTHROPIC_API_KEY` or
`CLAUDE_CODE_OAUTH_TOKEN` secrets are used.

> A PR that modifies a `claude-code-action` workflow file fails that workflow's
> own validation — it requires an admin-bypass merge.

## plato-pilot (`pilot.yml`)

Runs weekday mornings (ET). A once-weekday fix-proposer — **not** a monitor (the
monitor is log-watch, below). Per run, it reads `/tmp/pilot-report.md` (KPIs,
error codes, open pilot PRs as a **blocklist of issues with an open PR**, pilot
merge-rate track record, tier-classified `ready-for-pilot` issues with each
issue's author surfaced as `(by @login)` or `_(self-filed)_`), then picks ONE
signal or SKIPs.

**Severity interrupt** (evaluated before the picking order): a data-loss-class
server error — `unhandled_error` / 5xx on a `PUT`/`POST` write to `/v1/sync`
(surfaced by the report's Data-loss watch callout) — outranks the entire issue
queue regardless of count. The pilot fixes it or escalates with a loud
`SKIP: ESCALATING …` line, never defers it silently. This exists because a
400 KB write-size bug lost learner conversations for 8 days while the pilot
worked one-line copy issues (#195).

**Strict picking order** (top-down — first match wins, no jumping ahead because
something later looks higher-impact):

1. community-authored `ready-for-pilot` issue (author ≠ `plato-pilot`),
   tier-ranked then oldest-first;
2. self-filed `ready-for-pilot` issue;
3. high-count server error on a learner-facing surface;
4. KPI signal.

Volume is not a tie-breaker against authored issues — a one-line community issue
beats a 50-instance error — **except** a data-loss-class error, which the
severity interrupt lifts above everything.

When the pick is issue-driven, the agent commits with a
`Co-Authored-By: <issue-author> <login@users.noreply.github.com>` trailer so
GitHub credits the issue author. Tiers: 1 (learner experience: exemplars, coach,
profiles) → 5 (DevOps). Every pilot PR body must include a Triage table
(Signal / Source / Tier / Decision / Why) plus a `User impact: low/medium/high`
line.

The blocklist is built from **every open PR** that references an issue via
`Fixes/Closes/Resolves #N`, not just `plato-pilot`-labeled PRs — so a
maintainer-authored PR claiming a `ready-for-pilot` issue blocks the pilot from
racing it (closing the dup-gap that produced #160). A pre-agent step emits the
blocklist to `/tmp/pilot-blocklist.txt`; a post-agent step closes any PR that
references a blocked issue (hard dup-gate). A final step auto-escalates looping
issues: when ≥2 closed-unmerged pilot PRs reference the same `ready-for-pilot`
issue, the step removes the label, adds `needs-info`, and posts a comment asking
the reporter to clarify.

**Anti-goals (never violate):** no hard lesson cutoffs, no pacing directive
tightening, `extendedLessons` is informational only.

> Pilot revision commits can stack: the pilot's "Address review feedback" can
> stack on top without reverting — always check the cumulative diff against base.

## log-watch (`log-watch.yml`)

Runs every 2 hours — plato's **data-loss alarm**, separate from the pilot.
`scripts/log-watch.js` logs into the admin API, reads
`GET /v1/admin/logs?view=groups`, and if any `unhandled_error` group's sample is
a `PUT`/`POST` to `/v1/sync` (a learner-data write failing server-side) it opens
a GitHub issue labelled `data-loss` + `ready-for-pilot`. Idempotent: while a
`data-loss` issue is open it suppresses duplicates — close the issue once the
failure is fixed. No AWS credentials (the endpoint proxies CloudWatch); uses the
same `PLATO_API_URL` / `PLATO_ADMIN_EMAIL` / `PLATO_ADMIN_PASSWORD` secrets as
the pilot. Exists because a write-size bug lost learner conversations for 8 days
unnoticed (#195). See [`OBSERVABILITY.md`](OBSERVABILITY.md) for the tier model
and how to add a detector.

## Issue intake (`issue-intake.yml` + `issue-intake-sweep.yml`)

`issue-intake.yml` runs on every newly opened issue and classifies it as either
`ready-for-pilot` or `needs-info`. To qualify as `ready-for-pilot`, the issue
must name something concrete: an exact string/copy change, a specific error
message or screenshot, or a named component plus observed-vs-expected behavior.
Vague reports go to `needs-info` with ≤3 clarifying questions — a false-positive
`needs-info` is cheap, a false-positive `ready-for-pilot` fuels pilot loops.
Non-bug issues get no label, no comment. Idempotent via the labels.

**Backstop:** `issue-intake-sweep.yml` runs every 6 hours. If an on-open intake
run *fails* (e.g. a transient `claude-code-action` internal error, which is what
left #193 un-triaged and invisible to the pilot), the issue keeps no intake label
and falls silent. `scripts/intake-sweep.js` finds open, human-authored,
label-less issues older than an hour and re-dispatches `issue-intake.yml` on each
via its `workflow_dispatch` input; self-healing, since a successful re-run adds
the label and drops the issue from the next sweep.

The sweep's re-dispatch runs as the `github-actions[bot]` actor, so
`issue-intake.yml` must keep `github-actions` in `allowed_bots` — otherwise
`claude-code-action` rejects every retry as a "non-human actor" and the backstop
becomes a silent no-op (this is also the only path that triages issues from
reporters without repo write access, whose on-open run `claude-code-action`
blocks by design).

## Auto code review (`code-review.yml`)

Runs on every PR (opened + synchronize) and posts a review as `claude[bot]`.
Reviews are per-commit idempotent: the guard step queries existing reviews and
skips when a `claude[bot]` review already exists for the current head sha. New
commits (different sha) — including `revise.yml`'s fixup pushes — still get
reviewed. The job still completes when skipped so the required `review` status
check is satisfied. The reviewer prompt instructs the agent to submit exactly
ONE `gh pr review` call. Reviewers must call out live-user impact explicitly and
end every review body with a one-line `User impact:` summary — because merges
auto-deploy to prod, the review is the last human-free checkpoint. A
post-action verify step fails the job if the agent exits without posting a
review. Only one automated reviewer should be active at a time; if the hosted
Claude GitHub App is also installed with auto-review enabled, disable it there to
prevent duplicate reviews.

## Deploy dispatch & environments

Deploy workflows live only in the private fork (UIC-OSF/learn.ai-leaders.org),
not in the public repo. Deploys are automated via `repository_dispatch`: pushing
to `main` triggers `.github/workflows/trigger-deploy.yml`, which fires a
`deploy-prod` dispatch to the private fork; pushing to `playground` fires
`deploy-playground`. The private fork's `deploy.yml` / `deploy-playground.yml`
listen for those events, check this repo out at the dispatched SHA, and run SAM
deploy.

One-time setup: a `DEPLOY_DISPATCH_TOKEN` secret on this repo (fine-grained PAT
with `contents:write` on the deploy fork). Manual deploy: run `Trigger Deploy`
here via `workflow_dispatch` with a `target` input (`prod` / `playground` /
`both`), or run `Deploy to AWS` / `Deploy to Playground` directly from the
private fork's Actions tab with an optional `ref` input.

- **prod** (`plato` stack) — learn.ai-leaders.org, auto-deploys on push to `main`.
- **playground** (`plato-playground` stack) — playground.ai-leaders.org,
  auto-deploys on push to `playground`.

For the full deploy procedure, SSM parameters, and backup layers, see
[`DEPLOY.md`](DEPLOY.md).

## Branch protection

`main` and `playground` are ruleset-protected (required PR + 1 approving review +
passing `review` status check from the Code Review workflow; no force pushes; no
deletion). Blake as repository admin is on the bypass list with
`bypass_mode: always` for emergency overrides.

## Versioning

Version is tag-based (`Beta-RC-X`). On push to main,
`.github/workflows/version-bump.yml` creates the next `Beta-RC-N` git tag +
GitHub release. There's no `version.json` tracked in git — the deploy workflow
generates it from the latest tag before packaging Lambda. Local dev: no
version.json means the admin sidebar hides the version label; that's intentional.
