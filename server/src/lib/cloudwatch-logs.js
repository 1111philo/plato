// CloudWatch Logs reader for the /v1/admin/logs endpoint. Never swallows errors
// silently — a failure populates `error` in the returned shape so callers
// (plato-pilot in particular) can treat the outage as a distinct signal.

const ERROR_PATTERN = '?ERROR ?Error ?error ?WARN ?warn ?TimeoutError ?"Task timed out"';
const PER_GROUP_LIMIT = 100;

function stage() {
  return process.env.STAGE || 'prod';
}

function logGroupPrefix() {
  return `/aws/lambda/plato-${stage()}-`;
}

function parseMessage(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try { return JSON.parse(trimmed); }
  catch { return null; }
}

function normalizeEvent(event, logGroupName) {
  const ts = new Date(event.timestamp).toISOString();
  const parsed = parseMessage(event.message);
  if (parsed && typeof parsed.code === 'string') {
    const { level, code, ...meta } = parsed;
    return {
      logId: `cw_${event.eventId}`,
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

export async function fetchCloudWatchLogs({ since }) {
  if (!process.env.AWS_REGION) {
    return { entries: [], logGroups: [], error: 'AWS_REGION not set' };
  }
  let client;
  try {
    const mod = await import('@aws-sdk/client-cloudwatch-logs');
    const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = mod;
    client = new CloudWatchLogsClient({});
    const prefix = logGroupPrefix();

    const groupsRes = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit: 20 }));
    const logGroups = (groupsRes.logGroups || []).map((g) => g.logGroupName).filter(Boolean);
    if (!logGroups.length) {
      return { entries: [], logGroups: [], error: null };
    }

    const startTime = since ? new Date(since).getTime() : Date.now() - 24 * 60 * 60 * 1000;
    const perGroup = await Promise.all(logGroups.map(async (name) => {
      const res = await client.send(new FilterLogEventsCommand({
        logGroupName: name,
        filterPattern: ERROR_PATTERN,
        startTime,
        limit: PER_GROUP_LIMIT,
      }));
      return (res.events || []).map((e) => normalizeEvent(e, name));
    }));

    const entries = perGroup.flat().sort((a, b) => b.ts.localeCompare(a.ts));
    return { entries, logGroups, error: null };
  } catch (err) {
    return { entries: [], logGroups: [], error: err?.message || String(err) };
  }
}
