// Stale-while-revalidate cache for the admin dashboard's lesson stats.
//
// The /v1/admin/stats/lessons aggregation walks every user × every sync-data
// item — costly to recompute on every dashboard load. The data tolerates
// minutes of lag (lastActiveAt updates lag on the same order), so we cache
// the result in `_system:stats:lessons` and serve stale-while-revalidate:
//
//   age < FRESH_TTL_MS  -> serve cached, no recompute
//   older (stale or expired) -> serve cached + one async refresh at a time
//                          (a `refreshingAt` claim on the record, #451 H5)
//   no cache at all     -> recompute synchronously (a brand-new install)
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

/** Is there a function to send a background refresh to? (Not in local dev or tests.) */
export function canRefreshAsync() {
  return !!(process.env.JOBS_FUNCTION || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Returns true when a refresh invocation was sent, false when there's no function to invoke (local dev) or it failed. */
export async function kickoffAsyncRefresh() {
  // The API function runs internal events. The stream function (all CloudFront
  // traffic) can't: its streaming handler only takes HTTP events, so it points
  // at the API function through JOBS_FUNCTION. Before this, prod logged 51
  // refresh invokes and 0 completions over 14 days (see lib/jobs.js).
  const fnName = process.env.JOBS_FUNCTION || process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!fnName) return false; // local dev / tests
  try {
    await getLambdaClient().send(new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ __platoInternal: SELF_INVOKE_MARKER })),
    }));
    logger.warn('stats_async_refresh_invoked', { function: fnName });
    return true;
  } catch (err) {
    logger.error('stats_async_refresh_invoke_failed', { error: err?.message || String(err) });
    return false;
  }
}
