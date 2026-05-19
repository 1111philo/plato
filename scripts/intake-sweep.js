#!/usr/bin/env node

/**
 * intake-sweep — backstop for the issue-intake workflow.
 *
 * issue-intake runs on `issues: opened` and gives every new issue an outcome
 * (label `ready-for-pilot` / `needs-info` / `needs-decomposition`, or close).
 * But if that run *fails* — e.g. a transient `claude-code-action` internal
 * error, which is exactly what happened to #193 — the issue is left with NO
 * intake label, no comment, and silent. plato-pilot only picks labelled
 * issues, so an un-triaged issue is invisible to the whole automated pipeline
 * and the reporter never hears back.
 *
 * This sweep finds open, human-authored issues that carry no intake label and
 * are old enough that their on-open run should already have finished, then
 * re-dispatches issue-intake on each via its `workflow_dispatch` input.
 * Self-healing: once intake succeeds the label appears and the issue drops
 * out of the next sweep. Runs every 6 hours.
 *
 * Required env: GH_TOKEN (for the `gh` CLI).
 *
 * Usage: node scripts/intake-sweep.js
 */

import { execFileSync } from 'node:child_process';

const INTAKE_LABELS = ['ready-for-pilot', 'needs-info', 'needs-decomposition'];
const MIN_AGE_MINUTES = 60; // give the on-open intake run time to finish first
const MAX_DISPATCH = 10;    // flood guard — defer the rest to the next sweep

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// issue-intake already skips bot-authored issues; mirror that so the sweep
// never re-dispatches one that intake would just skip.
function isBot(login) {
  return !login || login.endsWith('[bot]') || login === 'plato-pilot';
}

/**
 * Open, human-authored issues with no intake label, old enough that their
 * on-open intake run should have completed. Exported for testing.
 */
export function untriagedIssues(issues, now = Date.now()) {
  const cutoff = now - MIN_AGE_MINUTES * 60 * 1000;
  return (issues || []).filter((i) => {
    if (isBot(i.author?.login)) return false;
    if ((i.labels || []).some((l) => INTAKE_LABELS.includes(l.name))) return false;
    if (new Date(i.createdAt).getTime() > cutoff) return false; // too fresh — let on-open run land
    return true;
  });
}

function main() {
  const issues = JSON.parse(
    gh(['issue', 'list', '--state', 'open', '--limit', '100',
      '--json', 'number,title,labels,author,createdAt']) || '[]',
  );

  const untriaged = untriagedIssues(issues);
  if (!untriaged.length) {
    console.log('intake-sweep: every open issue has an intake outcome.');
    return;
  }

  const batch = untriaged.slice(0, MAX_DISPATCH);
  console.log(`intake-sweep: ${untriaged.length} un-triaged issue(s); re-dispatching intake for ${batch.length}.`);
  for (const issue of batch) {
    gh(['workflow', 'run', 'issue-intake.yml', '-f', `issue_number=${issue.number}`]);
    console.log(`  → re-dispatched issue-intake for #${issue.number}: ${issue.title}`);
  }
  if (untriaged.length > batch.length) {
    console.log(`intake-sweep: ${untriaged.length - batch.length} deferred to the next sweep (flood guard).`);
  }
}

// Allow `import` for unit tests without running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error('intake-sweep failed:', err.message);
    process.exit(1);
  }
}
