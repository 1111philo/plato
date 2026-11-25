#!/usr/bin/env node
/**
 * Are there passing evaluation results for this commit? Used by the pre-push
 * hook and by the GitHub check (.github/workflows/agent-evals.yml). Never
 * calls the model; only built-in Node modules, so it runs without `npm ci`.
 *
 *   node server/scripts/evals/check.js --base origin/playground [--level moments|full] [--summary out.md]
 *
 * Exit 0 when nothing evaluated changed since `base`, or when
 * evals/results/<fingerprint>-<level>.json exists for HEAD, passed, and
 * covers every affected agent (a full run also satisfies `moments`).
 * Exit 1 otherwise, saying why. `--json` prints the decision.
 */
import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AGENTS, SUITES, affectedAgents, changedSince, fingerprint } from './lib/watch.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');

/** The decision: `{ ok, reason, affected, fingerprint, level, results? }`. */
export function decide({ root = REPO, base, level = 'moments' }) {
  const affected = affectedAgents(changedSince(root, base));
  const fp = fingerprint(root);
  if (!affected.length) return { ok: true, reason: 'Nothing the evaluations cover changed.', affected, fingerprint: fp, level };
  // A release also needs the whole lessons and the chains.
  const need = level === 'full' ? [...AGENTS, ...SUITES] : affected;
  const files = (level === 'full' ? ['full'] : ['full', 'moments']).map((l) => join(root, 'evals', 'results', `${fp}-${l}.json`));
  const file = files.find((f) => existsSync(f));
  if (!file) return { ok: false, reason: `No evaluation results for this version (${fp}, ${level}). Run: cd server && npm run eval -- ${level === 'full' ? '--level full' : '--affected'}`, affected, fingerprint: fp, level, missing: true };
  const results = JSON.parse(readFileSync(file, 'utf8'));
  const ran = new Set(results.agents || []);
  const notBuilt = new Set(results.notBuilt || []);
  const uncovered = need.filter((a) => !ran.has(a) && !notBuilt.has(a));
  if (uncovered.length) return { ok: false, reason: `The results don’t cover ${uncovered.join(', ')}.`, affected, fingerprint: fp, level, results };
  if (results.verdict !== 'pass') return { ok: false, reason: `The evaluations failed: ${results.failed} check(s).`, affected, fingerprint: fp, level, results };
  return { ok: true, reason: `Evaluations passed for this version (${results.passed} checks${results.pending ? `, ${results.pending} not yet expected` : ''}).`, affected, fingerprint: fp, level, results };
}

/** A short report for a pull request. */
export function report(d) {
  const lines = [`### Agent evaluations: ${d.ok ? 'passed' : 'not passed'}`, '', d.reason, ''];
  if (d.affected.length) lines.push(`Affected agents: ${d.affected.join(', ')}. Level required: ${d.level}. Version: \`${d.fingerprint}\`.`, '');
  const r = d.results;
  if (r) {
    lines.push(`Run ${r.startedAt} on ${r.model}, ${r.stats?.calls ?? '?'} model calls, ${r.took ?? '?'} s. Baseline: main ${r.baseline?.main?.slice(0, 7) || 'none'}.`, '');
    const failed = r.cases.flatMap((c) => Object.values(c.checks).filter((v) => v.verdict === 'fail').map((v) => `- ${c.agent} ${c.id}: ${v.title} (${v.fails} of ${v.n})`));
    if (failed.length) lines.push('**Failed:**', ...failed, '');
    const pending = r.cases.filter((c) => Object.values(c.checks).some((v) => v.verdict === 'pending'));
    if (pending.length) lines.push(`Not yet expected (reported, not blocking): ${pending.map((c) => `${c.agent} ${c.id}`).join(', ')}.`, '');
    if (r.notBuilt?.length) lines.push(`No evaluations built yet for: ${r.notBuilt.join(', ')}.`, '');
  }
  lines.push('How this works: docs/AGENT_EVALS.md, section 16.');
  return lines.join('\n');
}

function args(argv) {
  const out = { level: 'moments' };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] == null || argv[i + 1].startsWith('--') ? true : argv[++i];
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opt = args(process.argv.slice(2));
  if (!opt.base) { console.error('--base is required'); process.exit(2); }
  const d = decide({ base: opt.base, level: opt.level === 'full' ? 'full' : 'moments' });
  if (opt.json) console.log(JSON.stringify({ ...d, results: undefined }));
  else console.log(d.reason);
  if (opt.summary) (opt.summary === process.env.GITHUB_STEP_SUMMARY ? appendFileSync : writeFileSync)(opt.summary, report(d) + '\n');
  process.exit(d.ok ? 0 : 1);
}
