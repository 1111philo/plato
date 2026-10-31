# Launch release notes (Nov 2026)

Running index of the launch sprint. Every sub-PR merged into `playground`, every
data migration, and every decision lands here. The final `playground → main`
PR links this file. Upgrading installs come from **Beta-RC-232** (`629c778`).

## Decisions
| Decision | Source |
|---|---|
| Today's courses become **Units**; a new **Course** level sits above them. All existing units go into one default Course | #408, Blake 2026-10-30 |
| `playground` is the integration branch; one final PR into `main`, merged by Blake | Blake 2026-10-30 |
| Roles: Admin / Educator / Learner (renamed "user") / Tester (server-enforced read-only) | #435, Blake 2026-10-30 |
| Private research ID = the existing immutable `usr_…` id, admin contexts only | #386, Blake 2026-10-30 |
| plato-pilot keeps running; `ready-for-pilot` is removed from sprint issues (247 261 385 386 388 389 400 402 408 411 421 434 438) and restored on anything left open | Blake 2026-10-30 |
| Defaults (open to override): weekly digest + 7-day nudge; assessment page with "To be decided by the program team" notes; no AI-text detector; lesson rewrite drafts in the private deploy repo; Testers may take lessons; Educators get no logs or View-as; Getting Started arrives private on existing installs (admins get a notice to review and publish it); email automations ship OFF | sprint plan |

## Data migrations
| Id | What it changes | Reversible by | PR |
|---|---|---|---|
| `m003_role_learner` | stored role `user` → `learner` (conditional; `updatedAt` untouched) | `UPDATE … SET role='user' WHERE role='learner'` — and `normalizeRole` makes code indifferent to which is stored | roles PR |
| `m004_default_program` | creates `_system:program:prog-default` (one Course named after the classroom) holding every existing unit; each unit gains `programId` + its current name-sorted `lessonIds` | delete the program record; Beta-RC-232 ignores both | hierarchy PR |
| `m005_name_split` | users gain `firstName`/`lastName` inferred from `name` (split at the first whitespace; one word = first name only; empty names left alone), `nameSource: 'auto'`; `name` and `updatedAt` untouched; conditional on `name` unchanged and no split yet | drop the three fields; Beta-RC-232 reads only `name` | names PR |

## Sub-PRs merged into playground
| PR | Area | Issues |
|---|---|---|
| #444 | Data-migration runner and Beta-RC-232 upgrade gate | infra |
| #445 | Lockdown fixes: truncated streams, stream timeout, email escaping, dedupes | bugs |
| #446 | Lambda runtime → nodejs24.x | infra |
| #447 | View-as-User read-only enforced on the server | bug |
| #448 | Dialogs fit the viewport; admin skip link, main landmark, wide tables | #421, #385 (part) |
| #450 | Accessibility/e2e suite (Playwright + axe) and the fixes it found | a11y |
| #452 | Roles & permissions layer for /v1/admin | #435 |
| #453 | Educator, Tester, and Learner roles end to end | #435 |
| #454 | Course → Unit → Lesson hierarchy: storage, routes, ordering, migration | #408 |
| #455 | Courses & Units admin page; Unit picker grouped by course | #408 |
| #456 | Learner view of Course → Unit → Lesson; next lesson follows the order | #408 |
| #457 | First/last names on the server, migration `m005_name_split` | #402 |
| #458 | First/last name fields across the client; `preferences.name` retired | #402 |
| #459 | Compose while the coach replies; send-key and instant-text preferences | #247 |
| #460 | "Behind this response": which agents worked on each reply | #411 |
| #461 | Getting Started: bundled orientation lesson, installed and kept current | #443 |
| #462 | "Your work": objectives checklist, summary, shared work | #438, #414 |
| #463 | Notification email infrastructure; wait list confirmation | #388, #400 |
| #464 | Admin → Notifications (compose, automations, history); background jobs; stats-refresh fix | #389, #388 |
| #465 | Classroom bell, sign-in pop-up, Settings → Email | #389, #400 |
| #466 | Scheduled inactivity reminder and weekly digest | #400 |
| #467 | Users filters, Columns dialog (Users + Lessons), User ID | #362, #385, #386 |
| #468 | User groups: safe rename, duplicate check, sorted | #434 |
| #469 | Slack: add new accounts to a channel; plugin settings keep writeOnly values | #379 |
| #470 | Lesson rewrite scripts (drafts: UIC-OSF/plato-deploy#6) | #261 |
| #471 | "How assessment works" page; coach asks for learners' own thinking | #257, #414 |
| #472 | Accessibility pass: global focus ring restored (it was dropped site-wide), reflow at 320 px | a11y |
| #473 | Release prep: upgrade rehearsal script, these notes | release |
| #475 | Scheduled emails from traffic, not EventBridge (playground deploys were failing on missing `events:*`) | #400 |

## Upgrading from Beta-RC-232 (self-hosted installs)

Everything below happens automatically on the first start of the new
version. There are no manual steps. Reading this first is still worth it.

**1. Back up.** Point-in-time recovery should already be on (see
`docs/DEPLOY.md`). Take an on-demand backup of all five tables as well:

```bash
for t in users invites refresh-tokens sync-data audit-log; do
  aws dynamodb create-backup --table-name <stack>-$t --backup-name pre-launch-$t-$(date +%Y%m%d)
done
```

**2. See what will change, without changing anything.** From `server/`:

```bash
AWS_REGION=… USERS_TABLE=… SYNC_DATA_TABLE=… INVITES_TABLE=… node scripts/migrate.js
```

It lists each pending migration and what it would update. For a full
rehearsal (restore copies, migrate them, diff, then serve them with
Beta-RC-232's code), see `server/scripts/rehearse-upgrade.js`.

**3. Deploy.** On first start, the server:
- runs `m003_role_learner`, `m004_default_program`, and `m005_name_split`
  (table above). Each is conditional and idempotent, runs once per install
  under a lock, and never holds up serving for more than 20 s.
- installs **Getting Started** as a *private* lesson. Admin → Lessons asks
  an admin to review and publish it, so learners see nothing new until then.
- leaves every email automation **off**.

**4. Check.** Search the logs for `migration_applied`. Each migration logs
`{ scanned, updated, skipped, errors }`, and `errors` should be 0. A
migration with errors is retried on the next cold start. Then:
- Admin → Lessons → Courses & Units shows one Course (named after the
  classroom) holding your existing units in the same order. Rename it if
  you like.
- Admin → Users shows everyone's first and last name. Names split
  automatically carry a "Split automatically" hint until corrected.

**5. If you need to roll back,** redeploy Beta-RC-232. The migrated data is
compatible with it: the upgrade test serves migrated data with Beta-RC-232's
own route handlers (`server/tests/migrations/upgrade-from-rc232.test.js`).
Old code ignores the new fields and records, and treats `learner` like
`user`. To undo the data changes as well, see "Reversible by" in the
migrations table. Restoring the backup from step 1 is the last resort; it also
loses anything learners did after the upgrade.

**New settings to know:**
- `EmailAllowlist` stack parameter (`docs/DEPLOY.md`). Leave it empty on prod.
  On any other stage, empty means notification emails go to no one.
- The daily reminder and the Monday digest need no scheduler resource or new
  deploy permissions. Normal traffic triggers them (`server/src/lib/schedule.js`),
  and they do nothing until an admin turns those automations on.
- The API function's timeout is now 300 s, for background jobs.

## Prod rehearsal (2026-10-31)

**Dry run against prod itself** (`scripts/migrate.js`, read-only: it takes no
lock and makes no writes):
- `m003_role_learner`: 185 users scanned, 179 would update.
- `m004_default_program`: 5 units would go into one Course, named "Plato"
  after the classroom. The units are "0. Foundations" … "4. Job Placement",
  so name order equals their numbering and nothing reorders.
- `m005_name_split`: 184 would update. 12 names have 3+ parts, and 1 user has
  no name.

**Full rehearsal on a point-in-time copy of prod** (`scripts/rehearse-upgrade.js`
against `plato-rehearsal-*` restored from PITR; the tables were deleted
afterwards):
- All three migrations ran with 0 errors, and Getting Started was installed
  **private**.
- Diff: **0 removed**, 4 added (migration state, the Course, Getting
  Started, and its marker), 190 changed (the 185 users and 5 units, as
  expected).
- **5,304 learner records untouched, byte for byte**: 1,730 conversations,
  1,683 screenshots, 1,719 lesson progress records, 171 unit progress notes,
  and custom lessons.
- A second run did nothing.
- **Rollback:** Beta-RC-232's own route handlers served the migrated copy.
  Admin users (185), lessons (39), and courses (5), plus a learner's profile
  (role `learner`), lessons (35), and sync (75 records) all returned 200.

**Playground soak:** the same migrations ran on playground's real deploy on
2026-10-30 (all 0 errors). All 11 users' name parts rejoin exactly to their
unchanged `name`.

**Before Blake merges:** take on-demand backups of the five prod tables
(command in "Upgrading from Beta-RC-232" above) and record the ARNs here.
