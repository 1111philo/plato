/**
 * Background jobs (#389, #400): work too long for a request (emailing a whole
 * classroom) or run on a schedule. `dispatchJob(name, payload)` returns at
 * once:
 * - on Lambda, it invokes the **API function** asynchronously with
 *   `{ __platoInternal: 'platoJob', job, payload }`. The stream function (which
 *   serves all CloudFront traffic) finds it in `JOBS_FUNCTION`; the API
 *   function invokes itself. The stream handler can't take a non-HTTP event,
 *   so jobs never target it.
 * - locally and in tests, it runs the job in this process without waiting.
 *
 * `index.js`'s API handler routes job events to `runJob`. Jobs register
 * themselves with `registerJob(name, fn)`.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from './logger.js';

const JOB_MARKER = 'platoJob';
const jobs = new Map();
const pendingLocal = new Set();
let lambda = null;

/** Resolves when every in-process job has finished (local dev and tests). */
export async function whenJobsIdle() {
  while (pendingLocal.size) await Promise.allSettled([...pendingLocal]);
}

export function registerJob(name, fn) {
  jobs.set(name, fn);
}

export function isJobEvent(event) {
  return !!event && typeof event === 'object' && event.__platoInternal === JOB_MARKER && typeof event.job === 'string';
}

export async function runJob(name, payload = {}) {
  const fn = jobs.get(name);
  if (!fn) {
    logger.error('job_unknown', { job: name });
    return { error: 'unknown job' };
  }
  const started = Date.now();
  try {
    const result = await fn(payload);
    logger.warn('job_completed', { job: name, ms: Date.now() - started, ...(result && typeof result === 'object' ? result : {}) });
    return result;
  } catch (err) {
    logger.error('job_failed', { job: name, error: err?.message || String(err) });
    throw err;
  }
}

/** Fire and forget. Never throws; a failure to dispatch is logged. */
export async function dispatchJob(name, payload = {}) {
  const target = process.env.JOBS_FUNCTION || process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!target) {
    const p = new Promise((resolve) => setImmediate(resolve))
      .then(() => runJob(name, payload))
      .catch(() => {})
      .finally(() => pendingLocal.delete(p));
    pendingLocal.add(p);
    return { local: true };
  }
  try {
    await (lambda ||= new LambdaClient({})).send(new InvokeCommand({
      FunctionName: target,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ __platoInternal: JOB_MARKER, job: name, payload })),
    }));
    return { dispatched: true };
  } catch (err) {
    logger.error('job_dispatch_failed', { job: name, error: err?.message || String(err) });
    return { error: 'dispatch failed' };
  }
}
