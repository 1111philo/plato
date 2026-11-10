# Load tests

k6 scripts for an event-sized load on a **non-prod** stack (playground). They
refuse prod URLs and the prod table prefix. Results from the 2026-11-10 run
on playground are in `docs/RUNBOOK_EVENT_DAY.md` ("Load test").

| File | What it does |
|---|---|
| `users.mjs` | creates, counts, and deletes test accounts straight in the stack's DynamoDB tables, with the server's own db and password code |
| `learners.js` | k6: 0→900 learners signing in over 2 min, loading the classroom, saving a coach turn every 60–90 s, refocusing, refreshing a token; no AI |
| `ai.js` | k6: real coach streams through `POST /v1/ai/messages` (Bedrock): 50 at once × 3, then 100 at once × 2 (350 calls) |
| `analyze.mjs` | per-endpoint p50/p95/p99 and status codes from a k6 CSV |
| `cw.mjs` | the CloudWatch side for the same window: Lambda concurrency, cold starts, throttles; DynamoDB throttles and latency; Bedrock; plato's error codes |

## Running

Needs k6 (`brew install k6`), Node 20+, `server/` dependencies installed
(`cd server && npm ci`), and AWS credentials for the account
(`export AWS_PROFILE=… AWS_REGION=us-east-2`).

```bash
# 1. Accounts: loadtest+001…900@example.com, "Load Test 001"…, userId usr_loadtest_001…
#    The shared password and list go to scripts/loadtest/.out/users.json (gitignored).
node scripts/loadtest/users.mjs create 900

cd scripts/loadtest
# 2. Learners (about 9 minutes). Abort automatically past 5% failed requests.
date -u +%FT%TZ > .out/learners.start
k6 run -e BASE=https://playground.ai-leaders.org --out csv=.out/learners.csv learners.js
date -u +%FT%TZ > .out/learners.end
node analyze.mjs .out/learners.csv
node cw.mjs "$(cat .out/learners.start)" "$(cat .out/learners.end)"

# 3. AI (about 4 minutes, 350 Bedrock calls; aborts after 30 failed streams).
#    Wait 10 minutes after step 2 (or use OFFSET=…) so sign-ins don't pile onto
#    the per-IP login limit (1,000 per 10 min per container).
k6 run -e BASE=https://playground.ai-leaders.org --out csv=.out/ai.csv ai.js
node analyze.mjs .out/ai.csv --ttfb

# 4. Clean up, then confirm every count is 0.
cd ../.. && node scripts/loadtest/users.mjs delete && node scripts/loadtest/users.mjs count
```

Send requests through the CloudFront domain only: the server refuses requests
that skip CloudFront (`origin_not_verified`, #546).

## Things to know

- **One machine, one IP.** plato's per-IP sign-in limits (`AUTH_IP_LIMITS`,
  login 1,000 and refresh 3,000 per 10 minutes) count per Lambda container,
  so 900 sign-ins from one IP stay under them. Prod's CloudFront has a WAF
  rule on `/v1/auth/*` (10,000 per IP per 5 minutes); playground has none.
  Each VU signs in once and reuses its tokens.
- **Per-user AI limits** (30 calls a minute, 4 in flight) are per account, so
  `ai.js` gives every VU its own account.
- **Time to first token** is k6's `http_req_waiting`: the server holds the
  SSE headers until Bedrock's first event.
- **Bedrock metrics are per model, account-wide**: prod traffic on the same
  model shows up in `cw.mjs`'s Bedrock rows.
- **Cost:** the learner test is DynamoDB and Lambda pennies. `ai.js` at the
  default size is ~350 calls with ~9k input tokens each (about 3M tokens).
- **Delete** checks all three markers (userId, email, name) before deleting a
  user, then removes their sync-data, refresh tokens, and audit-log rows.
