// CloudWatch Logs reader for the /v1/admin/logs endpoint. Never swallows errors
// silently — a failure populates `error` in the returned shape so callers
// (plato-pilot in particular) can treat the outage as a distinct signal.

// CloudWatch filter patterns must have at least one required term; a pattern
// where every term is optional (prefixed with `?`) matches ALL events. We run
// two independent queries and merge — one for generic ERROR lines (which also
// matches logger's structured emissions that Lambda prefixes with "ERROR"),
// one for Lambda runtime timeouts that don't carry an ERROR prefix.
const FILTER_PATTERNS = ['ERROR', '"Task timed out"'];

// FilterLogEvents page size, and a hard cap on total events pulled per
// group+pattern query. The query is FULLY paginated (see filterAllPages) so
// the whole time window is covered. An earlier version passed a bare
// `limit: 100` with no nextToken follow — on a busy log group that returns
// only the oldest ~100 matches and silently drops the most recent errors.
// That is how 8 days of data-loss errors (`unhandled_error` on PUT /v1/sync)
// stayed invisible to the pilot's log report. See #195.
const PAGE_SIZE = 10000;
const MAX_EVENTS_PER_QUERY = 10000;

function stage() {
  return process.env.STAGE || 'prod';
}

// CloudFormation names the prod stack `plato` (not `plato-prod`) and the
// playground stack `plato-playground`. Lambda then auto-creates log groups
// of the form `/aws/lambda/<stack-name>-<LogicalId>-<hash>`. So the prefix
// that matches both plato Lambdas in a stage is `/aws/lambda/<stack-name>-`.
export function logGroupPrefix() {
  const s = stage();
  const stack = s === 'prod' ? 'plato' : `plato-${s}`;
  return `/aws/lambda/${stack}-`;
}

// The prod prefix `/aws/lambda/plato-` is ALSO a prefix of every playground
// group (`/aws/lambda/plato-playground-...`), so DescribeLogGroups returns
// playground groups for a prod query. Without this guard the prod logs
// endpoint mixes in playground errors. Exported for testing.
export function belongsToStage(logGroupName) {
  if (typeof logGroupName !== 'string') return false;
  if (stage() === 'prod') return !logGroupName.startsWith('/aws/lambda/plato-playground-');
  return true;
}

function parseMessage(message) {
  if (typeof message !== 'string') return null;
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(message.slice(start, end + 1)); }
  catch { return null; }
}

// Lambda-internal noise we never want to surface as errors.
function isLifecycleLine(message) {
  if (typeof message !== 'string') return false;
  return /^(START|END|REPORT|INIT_START|EXTENSION) /.test(message.trim());
}

// Node.js process warnings (Deprecation/Experimental/AWS-SDK version warnings)
// print to stderr; Lambda prefixes stderr lines with "ERROR" so they match our
// filter pattern — but they are NOT application errors. A warning emitted on
// every cold start would otherwise dominate the error report (bucketed as
// `cloudwatch_raw`) and bury the real errors underneath it. Exported for tests.
export function isProcessWarning(message) {
  if (typeof message !== 'string') return false;
  return /\(node:\d+\)\s+\S*Warning/i.test(message);
}

export function normalizeEvent(event, logGroupName) {
  if (isLifecycleLine(event.message) || isProcessWarning(event.message)) return null;
  const ts = new Date(event.timestamp).toISOString();
  const parsed = parseMessage(event.message);
  if (parsed && typeof parsed.code === 'string') {
    const { logId, level, code, ...meta } = parsed;
    return {
      // Use the original logId emitted by the logger so the endpoint can
      // dedupe against the in-process ring buffer.
      logId: logId || `cw_${event.eventId}`,
      ts,
      level: level === 'error' || level === 'warn' ? level : 'error',
      code,
      meta: { ...meta, logGroup: logGroupName, logStream: event.logStreamName },
      source: 'cloudwatch',
    };
  }
  return {
    logId: `cw_${event.eventId}`,
    ts,
    level: 'error',
    code: 'cloudwatch_raw',
    meta: { message: event.message?.trim().slice(0, 2048), logGroup: logGroupName, logStream: event.logStreamName },
    source: 'cloudwatch',
  };
}

// Fully paginate a FilterLogEvents query. FilterLogEvents returns a `nextToken`
// whenever more matches remain (it can even return one with an empty page
// while still scanning) — follow it so the entire window is covered, not just
// the first page. Capped at MAX_EVENTS_PER_QUERY as an OOM guard; hitting the
// cap is itself a flood signal. `client` / `FilterLogEventsCommand` are passed
// in so the loop is testable without the AWS SDK. Exported for testing.
export async function filterAllPages(client, FilterLogEventsCommand, params) {
  const events = [];
  let nextToken;
  do {
    const res = await client.send(new FilterLogEventsCommand({ ...params, limit: PAGE_SIZE, nextToken }));
    if (res?.events?.length) events.push(...res.events);
    nextToken = res?.nextToken;
  } while (nextToken && events.length < MAX_EVENTS_PER_QUERY);
  return events;
}

export async function fetchCloudWatchLogs({ since }) {
  if (!process.env.AWS_REGION) {
    return { entries: [], logGroups: [], error: 'AWS_REGION not set' };
  }
  try {
    const mod = await import('@aws-sdk/client-cloudwatch-logs');
    const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = mod;
    const client = new CloudWatchLogsClient({});
    const prefix = logGroupPrefix();

    const groupsRes = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit: 20 }));
    const logGroups = (groupsRes.logGroups || [])
      .map((g) => g.logGroupName)
      .filter(Boolean)
      .filter(belongsToStage);
    if (!logGroups.length) {
      return { entries: [], logGroups: [], error: null };
    }

    const startTime = since ? new Date(since).getTime() : Date.now() - 24 * 60 * 60 * 1000;
    const queries = logGroups.flatMap((name) =>
      FILTER_PATTERNS.map((pattern) => ({ name, pattern })),
    );
    const results = await Promise.all(queries.map(async ({ name, pattern }) => {
      const events = await filterAllPages(client, FilterLogEventsCommand, {
        logGroupName: name, filterPattern: pattern, startTime,
      });
      return events.map((e) => normalizeEvent(e, name)).filter(Boolean);
    }));

    // Dedupe across pattern queries (same event can match both patterns).
    const byEventId = new Map();
    for (const entry of results.flat()) {
      if (!byEventId.has(entry.logId)) byEventId.set(entry.logId, entry);
    }
    const entries = [...byEventId.values()].sort((a, b) => b.ts.localeCompare(a.ts));
    return { entries, logGroups, error: null };
  } catch (err) {
    return { entries: [], logGroups: [], error: err?.message || String(err) };
  }
}
