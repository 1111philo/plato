#!/usr/bin/env node

/**
 * Collects KPIs from plato's admin API and CloudWatch logs (via AWS CLI),
 * then outputs a markdown triage report for the pilot workflow.
 *
 * Required env vars:
 *   PLATO_API_URL          — e.g. https://learn.ai-leaders.org
 *   PLATO_ADMIN_EMAIL      — admin email for API login
 *   PLATO_ADMIN_PASSWORD   — admin password for API login
 *   AWS_REGION             — set by configure-aws-credentials
 *
 * Usage: node scripts/pilot-report.js > /tmp/pilot-report.md
 */

import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// KPIs via plato API
// ---------------------------------------------------------------------------

async function collectKpis() {
  const apiUrl = process.env.PLATO_API_URL;
  if (!apiUrl) throw new Error('PLATO_API_URL is required');

  const loginRes = await fetch(`${apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.PLATO_ADMIN_EMAIL,
      password: process.env.PLATO_ADMIN_PASSWORD,
    }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const { accessToken } = await loginRes.json();

  const statsRes = await fetch(`${apiUrl}/v1/admin/stats/lessons`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!statsRes.ok) throw new Error(`Stats API failed: ${statsRes.status}`);
  return statsRes.json();
}

// ---------------------------------------------------------------------------
// CloudWatch logs via AWS CLI
// ---------------------------------------------------------------------------

function collectLogs() {
  const windowMs = 24 * 60 * 60 * 1000;
  const startTime = Date.now() - windowMs;
  const noLogs = { errors: [], activity: [], logGroups: [], windowHours: 24 };

  // Check if AWS CLI is available and configured
  try {
    execSync('aws sts get-caller-identity', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
  } catch {
    console.error('AWS credentials not available — skipping CloudWatch logs');
    return noLogs;
  }

  // Find plato log groups
  let logGroups = [];
  try {
    const raw = execSync(
      `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/plato- --query "logGroups[].logGroupName" --output json`,
      { encoding: 'utf-8', timeout: 30000 },
    );
    logGroups = JSON.parse(raw);
  } catch {
    return noLogs;
  }

  const errors = [];
  const activity = [];

  for (const logGroup of logGroups) {
    try {
      const errRaw = execSync(
        `aws logs filter-log-events --log-group-name "${logGroup}" --start-time ${startTime} --filter-pattern '?ERROR ?Error ?error ?WARN ?warn ?TimeoutError ?"Task timed out"' --limit 50 --query "events[].{timestamp:timestamp,message:message}" --output json`,
        { encoding: 'utf-8', timeout: 30000 },
      );
      for (const event of JSON.parse(errRaw)) {
        errors.push({
          logGroup,
          timestamp: new Date(event.timestamp).toISOString(),
          message: event.message.trim().slice(0, 500),
        });
      }
    } catch { /* empty or inaccessible */ }

    try {
      const actRaw = execSync(
        `aws logs filter-log-events --log-group-name "${logGroup}" --start-time ${startTime} --limit 20 --query "events[].{timestamp:timestamp,message:message}" --output json`,
        { encoding: 'utf-8', timeout: 30000 },
      );
      for (const event of JSON.parse(actRaw)) {
        activity.push({
          logGroup,
          timestamp: new Date(event.timestamp).toISOString(),
          message: event.message.trim().slice(0, 300),
        });
      }
    } catch { /* empty or inaccessible */ }
  }

  return { errors, activity, logGroups, windowHours: 24 };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function main() {
  const [kpis, logs] = await Promise.all([collectKpis(), Promise.resolve(collectLogs())]);

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
| Over target (${kpis.exchangeTarget + 1}-${kpis.hardLimit - 1}) | ${kpis.overTarget} |
| Hard limit hits (${kpis.hardLimit}+) | ${kpis.hitHardLimit} |
| Avg exchanges/completion | ${kpis.avgExchangesPerCompletion ?? 'N/A'} |
| Avg exchanges (on-target) | ${kpis.avgExchangesWithinTarget ?? 'N/A'} |
| Avg exchanges (over-target) | ${kpis.avgExchangesOverTarget ?? 'N/A'} |
| Active lessons | ${kpis.activeLessons} |

## CloudWatch Errors (last 24h)

${formatErrors(logs)}

## CloudWatch Activity Summary

${logs.activity.length} log events across ${logs.logGroups.length} log groups in the last ${logs.windowHours}h.
${logs.activity.length > 0 ? '\nSample:\n```json\n' + JSON.stringify(logs.activity.slice(0, 15), null, 2) + '\n```' : ''}
`;

  process.stdout.write(report);
}

function formatErrors(logs) {
  if (logs.errors.length === 0) return 'No errors found.';
  return '```json\n' + JSON.stringify(logs.errors.slice(0, 50), null, 2) + '\n```';
}

main().catch((err) => {
  console.error('pilot-report failed:', err.message);
  process.exit(1);
});
