# After the launch: what's left on partly-done issues

The launch release (#451) delivered part of each issue below. This is what
remains, so the next person (or plato-pilot) starts in the right place.

| Issue | Done in the launch | Left |
|---|---|---|
| #257 How assessment works | Public `/how-assessment-works` page describing what plato actually does; coach asks for learners' own thinking | The three "To be decided by the program team" policies on the page: AI-assisted work, human review and appeals, what course completion certifies (and each course's competencies, written in that classroom's own content) |
| #261 Lesson rewrites | Export/apply scripts; drafts for Foundations 1–3 and AI Leadership 1–7 (UIC-OSF/plato-deploy#6) | Review the drafts, compare before/after with an outside reader, apply with `server/scripts/apply-lessons.js`; then the remaining lessons |
| #385 Admin table columns | Columns dialog (show, hide, reorder; saved per browser) for Users and Lessons; tables scroll instead of clipping | Column resizing |
| #414 Originality feedback | Coach asks for personal examples and reasons, never accuses; the "Your work" checklist only counts evidence in the learner's own words | Any separate visual indicator, once the policy in #257 is set (no AI-text detector, per #272) |
| #443 Getting Started | Bundled lesson, installed and kept current on every install; shown first | Requiring it before other lessons, once completion-based prerequisites (#442) exist |

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
- **No bounce or complaint handling for SES.**
- **Screenshots from failed turns are left behind** as orphaned `screenshot:*` records.

## From tester QA on the launch build (Nov 5)

Valid, but left for after the launch:

- **Two admin tabs editing the same user: the last save wins** without warning. User records have no version check; add `updatedAt`-based optimistic locking to `PATCH /v1/admin/users/:userId` (409 + "changed since you opened it").
- **Courses can't be reordered** (units and lessons can). Courses sort by name; add an order (e.g. `_system:programOrder`) and Move up/down in Courses & Units. Getting Started already shows first.
- **Likely-typo email domains** (`gamil.com`) are accepted on the wait list. Product decision: warn ("did you mean gmail.com?") rather than reject.
- **The wait-list rate limit is per server instance** (5 per 10 min), so a burst can spread across Lambda containers and get past it. A shared counter (DynamoDB TTL item per IP) would make it exact.
- **Prompt injection is mitigated, not solved.** The coach and profile prompts now ignore claims of authority (measured 0/4 vs 4/4), but a determined learner may find phrasings that work. Completion still rests on the model's judgment; a second-opinion check on the completing turn would harden it.
- **The profile summary sometimes notes that it ignored an instruction.** Harmless, but noisy.
