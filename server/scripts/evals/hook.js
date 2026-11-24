#!/usr/bin/env node
/**
 * The pre-push hook's work (.githooks/pre-push). For the branch checked out
 * here, when the push changes what the evaluations cover and there are no
 * passing results for its commit: run them (the affected agents; every agent,
 * at full level, for `playground`, which is released to `main`), commit the
 * results, and ask for the push again. A failing run stops the push and says
 * why.
 *
 * Git passes the refs on stdin: `<local ref> <local sha> <remote ref> <remote sha>`.
 */
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decide } from './check.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();

const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
const head = git('rev-parse', 'HEAD');
// Only the branch checked out here can be evaluated (the harness reads this checkout).
const pushes = lines.filter(([, sha]) => sha === head);

let exit = 0;
for (const [, , remoteRef] of pushes) {
  const branch = remoteRef.replace('refs/heads/', '');
  if (branch === 'main') continue; // main only moves by merging a release PR, which the check gates.
  const release = branch === 'playground';
  const base = release ? 'origin/main' : 'origin/playground';
  const level = release ? 'full' : 'moments';
  try { git('fetch', '--quiet', 'origin', release ? 'main' : 'playground'); } catch { /* offline: use what we have */ }
  const d = decide({ base, level });
  if (d.ok) { if (d.affected.length) console.error(`plato evals: ${d.reason}`); continue; }
  if (d.results && !d.missing && d.results.verdict === 'fail') {
    console.error(`plato evals: ${d.reason} See evals/reading/${d.fingerprint}-${d.results.level}.md. Fix and commit, then push again.`);
    exit = 1;
    continue;
  }
  console.error(`plato evals: ${d.affected.join(', ')} changed; running the evaluations (${level}). This calls the model with your AWS login.`);
  const run = spawnSync(process.execPath, [join(here, 'run.js'), ...(level === 'full' ? ['--level', 'full'] : ['--affected', '--base', base])], { cwd: join(REPO, 'server'), stdio: 'inherit' });
  const after = decide({ base, level });
  if (run.status !== 0 || !after.ok) {
    console.error(`plato evals: not passed (${after.reason}). The push is stopped. Results: evals/results/, reading pack: evals/reading/.`);
    exit = 1;
    continue;
  }
  git('add', '-A', '--', 'evals'); // results, reading pack, baseline (evals/scratch is ignored)
  try { execFileSync('git', ['commit', '-q', '-m', `Evaluation results for ${after.fingerprint} (${level})`], { cwd: REPO, stdio: 'inherit' }); } catch { /* nothing new to commit */ }
  console.error('plato evals: passed. The results are committed; push again to include them.');
  exit = 1;
}
process.exit(exit);
