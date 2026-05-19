#!/usr/bin/env node

/**
 * log-watch — scheduled data-loss alerting.
 *
 * Polls plato's `/v1/admin/logs` for write-path server errors — an
 * `unhandled_error` on a PUT/POST to `/v1/sync` means a learner's saved work
 * (conversation, lesson progress) is failing to persist server-side — and
 * opens a GitHub issue when one is firing.
 *
 * Runs every couple of hours via `.github/workflows/log-watch.yml`,
 * independent of the once-weekday plato-pilot. The pilot is a fix-proposer,
 * not a monitor: a 400 KB write-size bug lost learner conversations in prod
 * for 8 days before anyone noticed (#195). This is the missing alarm.
 *
 * Required env:
 *   PLATO_API_URL          — e.g. https://learn.ai-leaders.org
 *   PLATO_ADMIN_EMAIL      — admin email for API login
 *   PLATO_ADMIN_PASSWORD   — admin password for API login
 *   GH_TOKEN               — for the `gh` CLI (set by the workflow)
 *
 * Usage: node scripts/log-watch.js
 */

import { execFileSync } from 'node:child_process';

// One open issue carries the signal; while it is open the alert is already
// raised, so further detections must not pile on duplicates.
const DEDUP_LABEL = 'data-loss';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function login(apiUrl) {
  const res = await fetch(`${apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.PLATO_ADMIN_EMAIL,
      password: process.env.PLATO_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const { accessToken } = await res.json();
  if (!accessToken) throw new Error('login returned no accessToken');
  return accessToken;
}

/**
 * The write-path data-loss signature: an `unhandled_error` whose sample is a
 * PUT/POST to `/v1/sync` (the learner-data persistence surface). Matches the
 * "Data-loss watch" callout in scripts/pilot-report.js — keep the two in sync.
 * Exported for testing.
 */
export function dataLossGroups(logs) {
  return (logs?.groups || []).filter((g) => {
    if (g.code !== 'unhandled_error') return false;
    const m = g.sample?.meta || {};
    const method = String(m.method || '').toUpperCase();
    return (method === 'PUT' || method === 'POST') && String(m.path || '').startsWith('/v1/sync');
  });
}

function ensureLabels() {
  const labels = [
    [DEDUP_LABEL, 'B60205', 'Server-side write failure — learner data may not be saving'],
    ['ready-for-pilot', '1F883D', 'Triaged: enough info for plato-pilot or a human to act on'],
  ];
  for (const [name, color, description] of labels) {
    try {
      gh(['label', 'create', name, '--color', color, '--description', description]);
    } catch { /* already exists */ }
  }
}

function buildIssueBody(logs, hits, total) {
  const lines = hits.map((g) => {
    const m = g.sample?.meta || {};
    const err = String(m.error || '').replace(/\s+/g, ' ').slice(0, 160);
    return `- \`${g.code}\` ×${g.count} — \`${m.method} ${m.path}\` — _${err}_ (first ${g.firstSeen}, last ${g.lastSeen})`;
  });
  return [
    '**Automated data-loss alert** — raised by `log-watch` (`.github/workflows/log-watch.yml`).',
    '',
    `Write requests to \`/v1/sync\` are failing server-side in the last ${logs.windowHours ?? 24}h. `
      + "A failed sync write means a learner's saved work — conversation, lesson progress — may not be persisting.",
    '',
    `**${total} failure(s)** across ${hits.length} endpoint group(s):`,
    ...lines,
    '',
    'Investigate via `GET /v1/admin/logs` or CloudWatch (`/aws/lambda/plato-*`). '
      + 'The original instance of this class of bug — base64 screenshots blowing the '
      + "DynamoDB 400 KB item limit — is #195.",
    '',
    '_Close this issue once the underlying failure is fixed. While it stays open, '
      + 'log-watch suppresses duplicate alerts._',
  ].join('\n');
}

async function main() {
  const apiUrl = process.env.PLATO_API_URL;
  if (!apiUrl) throw new Error('PLATO_API_URL is required');

  const token = await login(apiUrl);
  const res = await fetch(`${apiUrl}/v1/admin/logs?view=groups`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`logs API failed: ${res.status}`);
  const logs = await res.json();

  const hits = dataLossGroups(logs);
  if (!hits.length) {
    console.log('log-watch: no write-path data-loss errors in the window.');
    return;
  }

  // Idempotent: only one open data-loss issue at a time.
  const open = JSON.parse(
    gh(['issue', 'list', '--label', DEDUP_LABEL, '--state', 'open', '--json', 'number']) || '[]',
  );
  if (open.length) {
    console.log(`log-watch: data-loss detected; issue #${open[0].number} already open — not duplicating.`);
    return;
  }

  const total = hits.reduce((n, g) => n + (g.count || 0), 0);
  ensureLabels();
  const out = gh([
    'issue', 'create',
    '--title', `Data-loss alert: ${total} failed /v1/sync write(s) in the last ${logs.windowHours ?? 24}h`,
    '--body', buildIssueBody(logs, hits, total),
    '--label', DEDUP_LABEL,
    '--label', 'ready-for-pilot',
  ]);
  console.log(`log-watch: opened data-loss issue — ${out.trim()}`);
}

// Allow `import` for unit tests without running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('log-watch failed:', err.message);
    process.exit(1);
  });
}
