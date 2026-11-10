# After the launch: what's left on partly-done issues

The launch release (#451) shipped to prod on 2026-11-09 as Beta-RC-237. It
delivered part of each issue below. The originals and Milestones 2 and 3 were closed on 2026-11-10; what's left continues in the follow-up issues. This is what remains, so the next person
(or plato-pilot) starts in the right place.

| Issue | Done in the launch | Left (follow-up issue) |
|---|---|---|
| #257 How assessment works | Public `/how-assessment-works` page describing what plato actually does; coach asks for learners' own thinking | The three "To be decided by the program team" policies on the page: AI-assisted work, human review and appeals, what course completion certifies (and each course's competencies, written in that classroom's own content) (#541) |
| #261 Lesson rewrites | Export/apply scripts; drafts for Foundations 1–3 and AI Leadership 1–7 (UIC-OSF/plato-deploy#6) | Review the drafts, compare before/after with an outside reader, apply with `server/scripts/apply-lessons.js`; then the remaining lessons |
| #385 Admin table columns | Columns dialog (show, hide, reorder; saved per browser) for Users and Lessons; tables scroll instead of clipping | Column resizing (#544) |
| #414 Originality feedback | Coach asks for personal examples and reasons, never accuses; the "Your work" checklist only counts evidence in the learner's own words | Any separate visual indicator, once the policy in #257 is set (no AI-text detector, per #272) (#542) |
| #443 Getting Started | Bundled lesson, installed and kept current on every install; shown first | Requiring it before other lessons, once completion-based prerequisites (#442) exist (#543) |

## Known gaps from the launch reviews

Found by the adversarial reviews of #451 and left for after the launch.
Each is small or rare. None can lose learner work without saying so.

- **`insights` has two audiences.** Learners see the coach's notes, and the coach also writes lesson-improvement notes for authors into the same field (`coach.md`). Give authors their own field.
- **Last-admin guard isn't atomic.** `DELETE /v1/me` counts admins with a scan, so if the only two admins delete themselves at the same moment, both can succeed.
- **A deleted default course can come back.** If m004 runs partway, an admin deletes `prog-default`, and the migration then retries, the course is created again.
- **The wait-list rate limit can be skipped by calling the Lambda Function URL directly.** Requests that go around CloudFront choose their own `X-Forwarded-For`. Fix it with a secret origin header from CloudFront, or with WAF.
- **A conversation too long to save has no recovery.** LessonChat says so and progress still saves, but later turns aren't kept. Start a fresh `messages:` segment instead.
- **Re-adopting Getting Started only recognizes today's copy.** A copy that RC-232 re-saved with an *older* canonical version shows as edited. Keep a list of past canonical hashes.
- **Educators see the User ID column and CSV** (review M7). Waiting on Blake's decision.
- **Testers can still write outside `/v1/admin`** (their own sync data, AI calls). This is by design so they can take lessons; revisit it if testers should be fully read-only.
- **`?include=stats` gets slower as the user list grows**, because it recomputes for every user on each request.
- **No bounce or complaint handling for SES.** See "Bounced and complained email addresses" below (#530).
- **Screenshots from failed turns are left behind** as orphaned `screenshot:*` records.

## From tester QA on the launch build (Nov 5)

Valid, but left for after the launch:

- **Two admin tabs editing the same user: the last save wins** without warning. User records have no version check; add `updatedAt`-based optimistic locking to `PATCH /v1/admin/users/:userId` (409 + "changed since you opened it").
- **Likely-typo email domains** (`gamil.com`) are accepted on the wait list. Product decision: warn ("did you mean gmail.com?") rather than reject.
- **The wait-list rate limit is per server instance** (5 per 10 min), so a burst can spread across Lambda containers and get past it. A shared counter (DynamoDB TTL item per IP) would make it exact.
- **Prompt injection is mitigated, not solved.** The coach and profile prompts now ignore claims of authority (measured 0/4 vs 4/4), but a determined learner may find phrasings that work. Completion still rests on the model's judgment; a second-opinion check on the completing turn would harden it.
- **The profile summary sometimes notes that it ignored an instruction.** Harmless, but noisy.

## From the third adversarial review (Nov 6)

- **Model: measure, don't assume.** Check in the selection method from `docs/MODEL_SELECTION.md` as `server/scripts/model-bench.js` (five scenarios, three trials: required-tag compliance, completion awards 10, injection resistance, TTFT and p50/p99 latency). Run it on every `coach.md` change and on candidates. `coach.md` has grown about 32% since Qwen3-VL was selected; its tag compliance at today's size is what `coach_tags_recovered` / `coach_tags_unrecovered` in `/v1/admin/logs` now show on real traffic.
- **Evaluate Magistral Small 1.2** (`mistral.magistral-small-2509`, Apache-2.0, image input, us-east-2) with that bench, and update `MODEL_SELECTION.md`. The doc's "exactly one eligible model" is out of date. Kimi K3 has image input but isn't OSI-licensed. The July doc's "~500 ms" latency trade is also smaller than what's measured now (p50 2.7 s, p99 12 s).
- **Wait-list limiter behind a direct Function URL call:** add a secret origin header from CloudFront (or WAF), and trust `X-Forwarded-For` only when it's present. Otherwise key on `sourceIp`.
- **Group rename recovery survives a reload:** the "Finish moving people" button only lasts until the dialog closes. Detect members whose group name isn't in the list and offer the move from there. The move-only server path should also 404 an `oldName` that no one has.
- **Slack Retry all** uses the signup call settings (4 s, no retries, fail on 429). Retry all over many users can pass 29 s; give it its own, more patient settings and run it as a job.
- **Focus-style test pass-throughs:** `focus:ring-0`, `*-transparent`, `shadow-none`, `ring-offset-0`, `.css` files, and class strings that span several lines aren't checked.
- **Publishing Getting Started lowers dashboard completion rates** on the day it's published (three new public lessons in every denominator). Consider leaving bundled lessons out of the KPIs, or calling it out in the release notes.
- **Policy (Blake):** a bundled lesson added in a *future* release goes public automatically if Getting Started lesson 1 is public. The recorded decision is "bundled content arrives private for review". Keep the auto-publish (no half-published course) or always arrive private?
- **`learnerNotes` trust:** learner-written notes go to the profile agents on every update, with only prompt text between them and the summary. A code-level filter, for example dropping notes that read as approvals or instructions, would make this sturdier.

## From the scale review (900 concurrent learners, Nov 7)

Fixed before launch in #515–#521. Left for after:

- **Alarms in IaC:** the 11 prod alarms (emailing b3b@uic.edu) were created with the CLI on 2026-11-07 (`docs/DEPLOY.md`). Moving them into `template.yaml`, so playground gets them too, needs `sns:*` and `cloudwatch:PutMetricAlarm` / `DeleteAlarms` on the deploy role.
- **Provisioned concurrency** on the stream function for event windows (about $25 for 3 hours at 300–500), and a reserved floor on the API function.
- **A load test** (k6, 0→900 virtual learners, plus 50→200 against real Bedrock) on playground. It needs a per-stage gate so the mock provider can run there.
- **A timed rollback drill** on playground, with the time written into the runbook.
- **Emailed verification before an email change.** Learners can't change their email in the UI today.
- **Shared rate limiters.** The per-user AI limits and per-IP auth limits are per Lambda container.
- **Two tabs on one lesson:** append-merge `messages:*` on 409 instead of overwriting.
- **Streaming render:** memoize persisted messages and the markdown renderer.
- **`GET /v1/branding`:** cap the logo size.
- **Audit log:** a TTL, and a `userId` index for `listAuditLogsForUser` (a full Scan; nothing calls it yet).
- **Compression for `/assets/*`:** cached at CloudFront but not showing as compressed yet.
- **`shadcn` to devDependencies** in the client.
- **S5 (policy):** learners can mark a lesson complete through `PUT /v1/sync`. At minimum, log a completion that has no conversation.
- **S6:** gate `issue-intake.yml` on author association, and SHA-pin its actions.
- **PITR on playground** (off), and in IaC once the deploy role can manage continuous backups.

## Bounced and complained email addresses (Nov 9)

SES already protects sender reputation: the account has account-level suppression on for bounces and complaints, so SES stops delivering to those addresses (verified 2026-11-09; status HEALTHY; one suppressed address, not plato's). The gap is that **plato doesn't know**: an invite to a suppressed address still says "Invite sent".

Post-launch fix: draft PR #530, built and tested, waiting on Blake's approval of its SES permissions (account-wide, because SES can't scope them):
- check suppression before every send and say "Not sent" instead
- a "Bounced" / "Marked as spam" badge in Admin → Users
- "Remove from the bounce list" in Edit User
- three SES suppression permissions on plato's Lambda roles

Kept out of the launch PR on purpose: it touches the invite and reset send paths and IAM.

## Considered and not pursued: Campaign Monitor (Nov 9)

We scoped replacing plato's email and in-app notifications with a Campaign Monitor plugin (Smart Emails for transactional mail, journeys and campaigns for engagement, contact sync from plato hooks), about two weeks plus setup. We decided to keep notifications in plato:
- it's built and tested
- no learner data goes to a third party
- one tool for admins
- it works for self-hosted installs

**Revisit if** there's real demand for campaign-style email (A/B tests, drip sequences, engagement analytics). If that happens, the cheaper option is a one-way contact sync to a Campaign Monitor list alongside plato's notifications, not a replacement. Keep password reset off third-party click tracking.

## Admin requests after the launch (Nov 9)

- **Lessons: filters and batch actions** (#526, #527, from stefinp23; both
  need-info). Users already has both: Filters (status, role, group, Slack,
  custom fields) and Update… (group, a field, or Slack link) for users and
  wait-list entries (#532–#534). Lessons has neither yet. The examples asked
  for: filter by course; select lessons, then make them private and share
  them with chosen users.
- **Editing one person who is also on the wait list** updates only the record
  you opened. Bulk update writes both records (#533).
