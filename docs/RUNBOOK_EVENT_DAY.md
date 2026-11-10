# Event-day runbook

For a session where many learners use plato at the same time, e.g. "everyone
open plato now" with a few hundred to ~900 people. It covers what to check
beforehand, what to watch while it runs, and how to stop or roll back. The
numbers come from the scale review on #451 (measured on the prod account,
us-east-2, 2026-11-06); re-check the ones marked *check* before each event.

## Capacity

| Resource | Limit | Needed for 900 learners |
|---|---|---|
| Lambda account concurrency | 50,000 (30-day peak used: 105) | a few hundred |
| Bedrock, `qwen.qwen3-vl-235b-a22b` | 10,000 requests/min, 100M tokens/min | ~1,800 req/min, ~7M tokens/min (estimate) |
| SES | production access, 50,000/day, 14/s | invites and notifications only |
| DynamoDB | on-demand tables; **per-partition** limit 3,000 RCU/s | the `_system` partition (lessons, prompts, settings) is the hot spot; see "Known limits" |

Bedrock latency: p50 2.7 s, p90 4.9 s, p99 12 s. *Check* the Bedrock quota in
Service Quotas the week before; ask AWS for more if the expected load is close.

## The day before

1. **Freeze deploys.** Set the repository variable `DEPLOY_FREEZE=true`
   (GitHub → Settings → Secrets and variables → Actions → Variables). Pushes to
   `main` then don't deploy to prod; a manual run of "Trigger Deploy" still
   does, for a deliberate fix or rollback. Unset it after the event.
2. **Back up.** On-demand backups of the five prod tables (command in
   `docs/RELEASE_NOTES_launch.md`, "Upgrading from Beta-RC-232"). Point-in-time
   recovery is on for prod (set in the console; the deploy role can't manage
   it, so it isn't in `template.yaml`). *Check* it's still `ENABLED`:
   `aws dynamodb describe-continuous-backups --table-name plato-sync-data`.
   Daily and weekly AWS Backup copies run on their own (vault `plato-prod`;
   `docs/DEPLOY.md` → Backups); *check* last night's completed.
3. **Use the right link.** Share `https://plato.courses`. `learn.ai-leaders.org`
   is a registrar redirect, one extra hop.
4. **Warm up.** Most containers at the start of an event are cold (~2 s for
   the first request). Provisioned concurrency on the stream function (300–500
   for the event window, roughly $25 for three hours) removes that; it's set on
   the function alias in the console or deploy repo. *Decision for the owner.*
5. **CloudFront** (prod distribution; applied 2026-11-07, details in
   `docs/DEPLOY.md`): `/assets/*` cached, origin read timeout 60 s, WAF rate
   rule on `/v1/auth/*` (10,000 per IP per 5 minutes, sized for a room on one
   Wi-Fi). *Check* they're still in place. Plato's own per-IP limits are sized
   the same way (`AUTH_IP_LIMITS`, wait-list 60), and wrong passwords lock the
   account, not the room.
6. **Alarms** (prod; created 2026-11-07, details in `docs/DEPLOY.md`) email
   b3b@uic.edu through SNS topic `plato-prod-alarms`. *Check* the
   subscriptions are confirmed and the alarms are `OK`:
   `aws cloudwatch describe-alarms --alarm-name-prefix plato-prod` (us-east-2,
   and us-east-1 for CloudFront).
7. **Tell the facilitators** to stagger "open plato now" over a few minutes
   (e.g. by table or group) if they can. A synchronized start is the worst case.

## During

- **Watch:** Admin → Home → logs (`GET /v1/admin/logs`), grouped by code. The
  codes that matter most: `unhandled_error`, `sync_item_too_large` and
  `conversation_too_long` (learner work not saving), `ai_stream_failed`,
  `ai_invoke_failed`, `coach_tags_unrecovered`. Meanings in
  `docs/OBSERVABILITY.md`. CloudWatch metrics for Lambda, DynamoDB, and Bedrock
  give the same picture without plato in the loop (the logs endpoint itself
  can be slow during an incident).
- **Kill switches that exist:** Admin → Notifications → Automations (turn every
  email automation off); Admin → Plugins (turn off a misbehaving plugin);
  `DEPLOY_FREEZE`. There's no "pause the AI" switch or site banner; an Admin →
  Notifications message marked important is the closest way to tell everyone
  something.

## Rollback

Redeploy the previous release with "Trigger Deploy" (manual run, target
`prod`) on the prior tag, then follow "If you need to roll back" in
`docs/RELEASE_NOTES_launch.md` (roles back to Beta-RC-232's names with
`server/scripts/rollback-roles.js`). *Time it once on playground* and write
the number here: **measured on playground 2026-11-10: 3 min 21 s** from
starting "Trigger Deploy" on `Beta-RC-239` to the site serving the old release
(deploy 3 min 18 s + first healthy response), and **3 min 23 s** to roll
forward again. Budget ~4 minutes. The release is live when the deploy run
finishes; check `https://plato.courses/v1/auth/setup-status` returns 200.

During the event, **don't roll back across Beta-RC-242** (2026-11-10) unless
you have to: anything older accepts direct Lambda and API Gateway URL calls
again (no origin check) and lets a lesson complete without a conversation.

## Load test (playground, 2026-11-10)

Scripts and how to rerun them: `scripts/loadtest/README.md`. From one test
machine, through CloudFront, against playground (Beta-RC-240 plus #546):

- **900 learners, no AI** (sign-in over 2 min, then a save every 60–90 s):
  30,027 requests, 0 errors, p50 ~150 ms and p99 ~300–600 ms on every
  endpoint (sign-in p99 588 ms). Lambda peaked at 32 concurrent; 78 cold
  starts at 1.2–1.6 s init. No DynamoDB or Lambda throttles.
- **900 sign-ins in 30 s:** 17,068 requests, 2 client-side timeouts; server
  time stayed p50 14 ms, p99 320 ms (the slower client numbers were the test
  machine's bandwidth, not plato). Peak concurrency 81.
- **Real Bedrock**, 50 then 100 coach streams at once (350 calls): all
  completed, no throttles. Time to first token p50 0.7 s, p95 1.6 s, p99
  3.5 s; full reply p50 3.2 s, p99 7.4 s.

**The time-estimate job runs once per warm container when it goes stale.**
`stats:timeStats` goes stale an hour after it's computed. Every container that
then serves `GET /v1/lessons/time-stats` asks for a refresh, so a cohort
loading at once starts dozens of copies of the same full-table job (37 in
seconds on the test). Three logged `job_failed` ("The conditional request
failed") because they lost the version race. DynamoDB on demand absorbed it,
so it's harmless, but don't page anyone over `job_failed` for
`lesson-time-stats` during the event.

## Known limits (from the scale review)

Fixed before launch (#516–#520): shared data cached for 30 s on learner paths
and parsed lessons list, so a classroom refocusing at once doesn't overload
the `_system` partition; time estimates precomputed; one-read setup check;
each save written once and one AI call per coach turn; the AI endpoint locked
to plato's model with per-user limits; reset links can't be used as sessions;
the refresh race that could sign a whole cohort out at the 15-minute mark.
What remains is listed in `docs/POST_LAUNCH.md`. The per-user AI limits and
per-IP limits count per Lambda container, so they're best-effort; the WAF rule
is the exact one for sign-in.
