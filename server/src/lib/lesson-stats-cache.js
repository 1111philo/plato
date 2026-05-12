// Stale-while-revalidate cache for the admin dashboard's lesson stats.
//
// The /v1/admin/stats/lessons aggregation walks every user × every sync-data
// item — costly to recompute on every dashboard load. The data tolerates
// minutes of lag (lastActiveAt updates lag on the same order), so we cache
// the result in `_system:stats:lessons` and serve stale-while-revalidate:
//
//   age < FRESH_TTL_MS  -> serve cached, no recompute
//   age < MAX_AGE_MS    -> serve cached + fire async refresh (self-invoke)
//   else                -> recompute synchronously, write back
//
// Async refresh in prod runs as a separate Lambda invocation
// (InvocationType: 'Event'). The handler at server/src/index.js detects the
// self-invoke payload and runs the refresh. Local dev / tests skip the
// invoke (AWS_LAMBDA_FUNCTION_NAME unset) — the next request that finds the
// cache stale will simply do another stale-serve until something eventually
// crosses MAX_AGE_MS and recomputes synchronously.

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from './logger.js';

export const FRESH_TTL_MS = 10 * 60 * 1000;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SELF_INVOKE_MARKER = 'refreshLessonStats';

let _lambda = null;
function getLambdaClient() {
  if (!_lambda) _lambda = new LambdaClient({});
  return _lambda;
}

export function isSelfInvokeEvent(event) {
  return event && typeof event === 'object' && event.__platoInternal === SELF_INVOKE_MARKER;
}

export function cacheAgeMs(cached) {
  const computedAt = cached?.data?.computedAt;
  if (!computedAt) return Infinity;
  const ms = Date.parse(computedAt);
  if (!Number.isFinite(ms)) return Infinity;
  return Date.now() - ms;
}

export function classifyCache(cached) {
  const age = cacheAgeMs(cached);
  if (age < FRESH_TTL_MS) return 'fresh';
  if (age < MAX_AGE_MS) return 'stale';
  return 'expired';
}

export async function kickoffAsyncRefresh() {
  const fnName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!fnName) return; // local dev / tests
  try {
    await getLambdaClient().send(new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ __platoInternal: SELF_INVOKE_MARKER })),
    }));
    logger.event('stats_async_refresh_invoked', { function: fnName });
  } catch (err) {
    logger.error('stats_async_refresh_invoke_failed', { error: err?.message || String(err) });
  }
}
