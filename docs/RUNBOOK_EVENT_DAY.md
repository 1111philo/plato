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
the number here: _not measured yet_.

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
