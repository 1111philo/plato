#!/usr/bin/env node

/**
 * Collects KPIs and server logs from plato's admin API, plus pilot PR/issue
 * state from the GitHub CLI, then outputs a markdown triage report for the
 * pilot workflow.
 *
 * Required env vars:
 *   PLATO_API_URL          — e.g. https://learn.ai-leaders.org
 *   PLATO_ADMIN_EMAIL      — admin email for API login
 *   PLATO_ADMIN_PASSWORD   — admin password for API login
 *
 * Optional: GH_TOKEN in env (for `gh` CLI auth, set by the workflow).
 *
 * Usage: node scripts/pilot-report.js > /tmp/pilot-report.md
 */

import { execFileSync } from 'node:child_process';

const ISSUE_REF_RE = /(?:fixes|closes|resolves)\s+#(\d+)/gi;

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`gh ${args.join(' ')} failed:`, err.stderr?.toString() || err.message);
    return '';
  }
}

function ghJson(args) {
  const out = gh(args);
  if (!out) return [];
  try {
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function linkedIssues(body) {
  if (!body) return [];
  const ids = new Set();
  for (const m of body.matchAll(ISSUE_REF_RE)) ids.add(Number(m[1]));
  return [...ids];
}

function classifyTier(issue) {
  const text = `${issue.title} ${issue.body || ''}`.toLowerCase();
  if (/\b(a11y|accessib|keyboard|screen\s*reader|voiceover|nvda|jaws|aria|mitre|orange)\b/.test(text)) return 2;
  if (/\b(coach|exemplar|lesson|learner\s*profile|kb\b|knowledge\s*base|prompt)\b/.test(text)) return 1;
  if (/\b(admin|dashboard|customizer|invite|classroom)\b/.test(text)) return 3;
  if (/\b(auth|token|sync[-\s]*data|visibility|share)\b/.test(text)) return 4;
  if (/\b(deploy|ci|cd|sam|cloudformation|lambda|cloudwatch|infra)\b/.test(text)) return 5;
  return 3;
}

function formatPilotTrackRecord(prs) {
  if (!prs.length) return '_No pilot PRs in the last 30 days._';

  const merged = prs.filter((p) => p.state === 'MERGED');
  const closed = prs.filter((p) => p.state === 'CLOSED');
  const open = prs.filter((p) => p.state === 'OPEN');
  const totalResolved = merged.length + closed.length;
  const mergeRate = totalResolved ? ((merged.length / totalResolved) * 100).toFixed(0) : 'N/A';

  const issueAttempts = new Map();
  for (const pr of prs) {
    for (const issueNum of linkedIssues(pr.body)) {
      if (!issueAttempts.has(issueNum)) issueAttempts.set(issueNum, []);
      issueAttempts.get(issueNum).push(pr);
    }
  }

  const loopedIssues = [];
  for (const [issueNum, attemptPrs] of issueAttempts) {
    const closedUnmerged = attemptPrs.filter((p) => p.state === 'CLOSED');
    if (closedUnmerged.length >= 2) {
      const prList = closedUnmerged.map((p) => `#${p.number}`).join(', ');
      loopedIssues.push(`- Issue #${issueNum}: ${closedUnmerged.length} closed-unmerged PRs (${prList}). **Do NOT re-attempt without new information from the reporter.**`);
    }
  }

  const lines = [
    `- Merged: ${merged.length} · Closed-unmerged: ${closed.length} · Open: ${open.length}`,
    `- Merge rate (of resolved): **${mergeRate}%**`,
  ];
  if (loopedIssues.length) {
    lines.push('', '### Looped issues (strong anti-signal)', ...loopedIssues);
  }
  return lines.join('\n');
}

function formatBlocklist(openPrs) {
  const blocked = new Set();
  const rows = [];
  for (const pr of openPrs) {
    const issues = linkedIssues(pr.body);
    for (const i of issues) blocked.add(i);
    const ref = issues.length ? issues.map((i) => `#${i}`).join(', ') : '_(no issue ref)_';
    rows.push(`| #${pr.number} | ${pr.title.replace(/\|/g, '\\|')} | ${ref} |`);
  }

  const marker = `<!-- PILOT_BLOCKLIST: ${[...blocked].sort((a, b) => a - b).join(',')} -->`;

  if (!openPrs.length) {
    return `${marker}\n_No open pilot PRs. Nothing is blocked._`;
  }

  const table = [
    '| Open PR | Title | Linked issues |',
    '|---------|-------|---------------|',
    ...rows,
  ].join('\n');

  const blockedList = blocked.size
    ? `**Issues blocked from re-picking:** ${[...blocked].sort((a, b) => a - b).map((i) => `#${i}`).join(', ')}`
    : '_No issues linked from open PRs._';

  return `${marker}\n\n${blockedList}\n\n${table}\n\n**Rule:** Do NOT open a PR that references any blocked issue. If the best signal points at a blocked issue, pick a different signal or SKIP.`;
}

function formatReadyIssues(issues, closedPilotPrs) {
  if (!issues.length) return '_No `ready-for-pilot` issues today._';

  const attemptedIssues = new Map();
  for (const pr of closedPilotPrs) {
    for (const issueNum of linkedIssues(pr.body)) {
      if (!attemptedIssues.has(issueNum)) attemptedIssues.set(issueNum, []);
      attemptedIssues.get(issueNum).push(pr.number);
    }
  }

  const byTier = new Map();
  for (const issue of issues) {
    const tier = classifyTier(issue);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(issue);
  }

  const sections = [];
  for (const tier of [...byTier.keys()].sort()) {
    sections.push(`### Tier ${tier}`);
    for (const issue of byTier.get(tier)) {
      const attempted = attemptedIssues.get(issue.number);
      const attemptNote = attempted?.length ? ` — ⚠️ previously attempted in closed PRs: ${attempted.map((n) => `#${n}`).join(', ')}` : '';
      sections.push(`- #${issue.number}: ${issue.title}${attemptNote}`);
    }
  }
  return sections.join('\n');
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const pilotPrs = ghJson([
    'pr', 'list',
    '--label', 'plato-pilot',
    '--state', 'all',
    '--limit', '50',
    '--json', 'number,title,state,body,createdAt,mergedAt,closedAt',
    '--search', `created:>=${thirtyDaysAgo.slice(0, 10)}`,
  ]);
  const openPilotPrs = pilotPrs.filter((p) => p.state === 'OPEN');
  const closedPilotPrs = pilotPrs.filter((p) => p.state === 'CLOSED');

  const readyIssues = ghJson([
    'issue', 'list',
    '--state', 'open',
    '--label', 'ready-for-pilot',
    '--limit', '30',
    '--json', 'number,title,body,createdAt',
  ]);

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

## Open pilot PRs (BLOCKLIST)

${formatBlocklist(openPilotPrs)}

## Pilot track record (last 30 days)

${formatPilotTrackRecord(pilotPrs)}

## Open \`ready-for-pilot\` issues (tier-classified)

${formatReadyIssues(readyIssues, closedPilotPrs)}
`;

  process.stdout.write(report);
}

main().catch((err) => {
  console.error('pilot-report failed:', err.message);
  process.exit(1);
});
