#!/usr/bin/env node

/**
 * Collects KPIs and server logs from plato's admin API, then outputs a
 * markdown triage report for the pilot workflow.
 *
 * Required env vars:
 *   PLATO_API_URL          — e.g. https://learn.ai-leaders.org
 *   PLATO_ADMIN_EMAIL      — admin email for API login
 *   PLATO_ADMIN_PASSWORD   — admin password for API login
 *
 * Usage: node scripts/pilot-report.js > /tmp/pilot-report.md
 */

async function login(apiUrl) {
  const res = await fetch(`${apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.PLATO_ADMIN_EMAIL,
      password: process.env.PLATO_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const { accessToken } = await res.json();
  return accessToken;
}

async function collectKpis(apiUrl, token) {
  const res = await fetch(`${apiUrl}/v1/admin/stats/lessons`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Stats API failed: ${res.status}`);
  return res.json();
}

async function collectLogs(apiUrl, token) {
  const res = await fetch(`${apiUrl}/v1/admin/logs?view=groups`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Logs API failed: ${res.status}`);
  return res.json();
}

function formatGroups(logs) {
  if (!logs.groups?.length) return 'No errors or warnings in the last 24h.';
  const rows = logs.groups.map((g) => {
    const sample = g.sample?.meta?.error || g.sample?.meta?.message || '';
    // Escape pipes so error messages containing `|` don't break the markdown
    // table columns (the pilot agent reads these rows directly).
    const preview = sample.toString().replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 120);
    return `| \`${g.code}\` | ${g.level} | ${g.count} | ${g.firstSeen} | ${g.lastSeen} | ${g.sources.join(', ')} | ${preview} |`;
  });
  return [
    '| Code | Level | Count | First seen | Last seen | Sources | Sample |',
    '|------|-------|-------|------------|-----------|---------|--------|',
    ...rows,
  ].join('\n');
}

function formatCloudWatchStatus(logs) {
  if (logs.cloudwatch?.error) {
    return `⚠️ CloudWatch fetch failed: \`${logs.cloudwatch.error}\`. In-process buffer errors above are still reliable; Lambda runtime errors (timeouts, uncaught panics before onError) may be missing.`;
  }
  const groupCount = logs.cloudwatch?.logGroups?.length ?? 0;
  return `CloudWatch lane queried ${groupCount} log group(s) successfully.`;
}

async function main() {
  const apiUrl = process.env.PLATO_API_URL;
  if (!apiUrl) throw new Error('PLATO_API_URL is required');

  const token = await login(apiUrl);
  const [kpis, logs] = await Promise.all([collectKpis(apiUrl, token), collectLogs(apiUrl, token)]);

  const onTargetRate = kpis.totalCompletions
    ? ((kpis.withinTarget / kpis.totalCompletions) * 100).toFixed(1)
    : 'N/A';

  let signal = 'green';
  if (onTargetRate !== 'N/A') {
    if (onTargetRate < 75) signal = 'yellow';
    if (onTargetRate < 50) signal = 'red';
  }

  const report = `# Pilot Report — ${new Date().toISOString().slice(0, 10)}

## KPI Snapshot (from plato admin API)

| Metric | Value |
|--------|-------|
| Total completions | ${kpis.totalCompletions} |
| On-target rate | ${onTargetRate}% (${signal}) |
| Within target (≤${kpis.exchangeTarget}) | ${kpis.withinTarget} |
| Over target (>${kpis.exchangeTarget}) | ${kpis.overTarget} |
| Extended (≥${kpis.extendedThreshold}, informational) | ${kpis.extendedLessons ?? 0} |
| Avg exchanges/completion | ${kpis.avgExchangesPerCompletion ?? 'N/A'} |
| Avg exchanges (on-target) | ${kpis.avgExchangesWithinTarget ?? 'N/A'} |
| Avg exchanges (over-target) | ${kpis.avgExchangesOverTarget ?? 'N/A'} |
| Active lessons | ${kpis.activeLessons} |

_Note: "Over target" means exchanges > target — not a failure. Lessons always run until the coach awards progress 10. If on-target rate is low, diagnose **lesson design** or **coach prompt quality**, not pacing enforcement — never introduce forced closures._

## Errors by code (last ${logs.windowHours ?? 24}h)

Errors: ${logs.counts?.error ?? 0} · Warnings: ${logs.counts?.warn ?? 0} · Buffer: ${logs.buffer?.used ?? 0}/${logs.buffer?.size ?? 0}

${formatGroups(logs)}

## CloudWatch lane status

${formatCloudWatchStatus(logs)}
`;

  process.stdout.write(report);
}

main().catch((err) => {
  console.error('pilot-report failed:', err.message);
  process.exit(1);
});
