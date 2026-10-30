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
| Defaults (open to override): weekly digest + 7-day nudge; assessment page with `[DECISION NEEDED]` markers; no AI-text detector; lesson rewrite drafts in the private deploy repo; Testers may take lessons; Educators get no logs or View-as; Getting Started arrives as a draft on existing installs; email automations ship OFF | sprint plan |

## Data migrations
| Id | What it changes | Reversible by | PR |
|---|---|---|---|
| `m003_role_learner` | stored role `user` → `learner` (conditional; `updatedAt` untouched) | `UPDATE … SET role='user' WHERE role='learner'` — and `normalizeRole` makes code indifferent to which is stored | roles PR |
| `m004_default_program` | creates `_system:program:prog-default` (one Course named after the classroom) holding every existing unit; each unit gains `programId` + its current name-sorted `lessonIds` | delete the program record; Beta-RC-232 ignores both | hierarchy PR |

## Sub-PRs merged into playground
| PR | Area | Issues |
|---|---|---|

## Upgrading from Beta-RC-232 (self-hosted installs)
Filled in before the final PR: backup command, what migrates, how to check the logs, how to roll back.
