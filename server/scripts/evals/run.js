#!/usr/bin/env node
/**
 * plato's agent evaluations (docs/AGENT_EVALS.md). From server/:
 *
 *   npm run eval -- [--agents coach,assessor | --affected [--base origin/playground]]
 *                   [--level moments|full] [--trials 6] [--concurrency 6]
 *                   [--calibrate] [--no-baseline] [--no-confirm] [--quiet] [--cases C61,W7]
 *
 * Runs each case several times against plato's model (Bedrock, us-east-2,
 * your AWS login), through the app's own code, and scores every check by its
 * pass mark (lib/score.js). "At least as good as today" compares with the
 * same cases run on `origin/main` (the baseline, run once per version of
 * main and kept in evals/baseline/). Writes evals/results/<fingerprint>-<level>.json
 * and a reading pack (evals/reading/), and exits 1 when anything fails.
 *
 * The pre-push hook (.githooks/pre-push) runs `--affected` for you; the
 * GitHub check (.github/workflows/agent-evals.yml) checks the results.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadApp } from './lib/app.js';
import { bedrockModel } from './lib/model.js';
import { AGENTS, SUITES, affectedAgents, changedSince, fingerprint, harnessFingerprint, uncommittedWatched } from './lib/watch.js';
import { judge, runVerdict } from './lib/score.js';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '..', '..', '..');
const EVALS = join(REPO, 'evals');
/** More trials for a failed "at least as good as today", on both versions. */
const CONFIRM_TRIALS = 12;

function args(argv) {
  const out = { level: 'moments', trials: '6', concurrency: '6', base: 'origin/playground' };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    out[k] = argv[i + 1] == null || argv[i + 1].startsWith('--') ? true : argv[++i];
  }
  return out;
}

/** An agent's module and cases (or a suite's: the whole lessons and the chains, `suites/`). */
export async function loadAgent(id) {
  const mod = await import(join(here, SUITES.includes(id) ? 'suites' : 'agents', `${id}.js`));
  const cases = JSON.parse(readFileSync(join(here, 'cases', `${id}.json`), 'utf8')).cases;
  return { id, ...mod, cases };
}

/** Is a check critical on a case: one slip fails the run, unconfirmed (lib/score.js). */
export function criticalFor(agent, c, check) {
  return !!(agent.CHECKS[check].critical || (c.never && check === 'falseShown') || c.critical?.includes(check));
}

/** A check's pass mark on a case: the case can raise or set it. */
export function markFor(agent, c, check) {
  if (c.mark === 'pending') return 'pending';
  if (c.marks?.[check]) return c.marks[check];
  if (c.never && check === 'falseShown') return 'never';
  return agent.CHECKS[check].mark;
}

async function pool(jobs, n, onDone) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < jobs.length) {
      const i = next++;
      try { out[i] = await jobs[i](); } catch (e) { out[i] = { error: `${e.name || 'Error'}: ${String(e.message || e).slice(0, 200)}` }; }
      onDone?.();
    }
  }));
  return out;
}

/**
 * Run `agents`' cases against one version of plato (`app`), `trials` times
 * each. Returns `{ [agent]: { [caseId]: { trials: [{ checks, sample } | { error }] } } }`.
 */
export async function runCases({ app, model, agents, trials, concurrency, progress, exact = false }) {
  const jobs = [];
  const slots = [];
  for (const agent of agents) {
    if (!agent.available(app)) continue;
    for (const c of agent.cases) {
      // `exact`: `trials` for every case (a confirmation), except whole lessons, one per lesson.
      for (let t = 0; t < (exact && !c.lessons ? trials : c.trials || trials); t++) {
        jobs.push(() => agent.run(c, { app, model, trial: t }));
        slots.push([agent.id, c.id]);
      }
    }
  }
  const done = await pool(jobs, concurrency, progress);
  const out = {};
  done.forEach((r, i) => {
    const [a, id] = slots[i];
    ((out[a] ||= {})[id] ||= { trials: [] }).trials.push(r);
  });
  return out;
}

/** Fails and runs per check, from raw trials. */
export function tally(raw) {
  const out = {};
  for (const [a, cases] of Object.entries(raw || {})) {
    for (const [id, { trials }] of Object.entries(cases)) {
      const checks = {};
      for (const t of trials) for (const [k, v] of Object.entries(t.checks || {})) {
        if (v === null) continue;
        (checks[k] ||= { fails: 0, n: 0 }).n++;
        if (v === false) checks[k].fails++;
      }
      (out[a] ||= {})[id] = checks;
    }
  }
  return out;
}

/** Score a candidate run against the baseline tally and calibration gaps. */
export function score({ agents, raw, baseline = {}, gaps = {} }) {
  const cases = [];
  for (const agent of agents) {
    for (const c of agent.cases) {
      const r = raw[agent.id]?.[c.id];
      if (!r) continue;
      const checks = {};
      for (const check of Object.keys(agent.CHECKS)) {
        const pick = (list) => list.filter((t) => !t.error).map((t) => (t.checks?.[check] === undefined ? null : t.checks[check]));
        // Trials after `confirmFrom` are the confirmation run's.
        const cf = r.confirmFrom ?? r.trials.length;
        const extra = cf < r.trials.length ? pick(r.trials.slice(cf)) : null;
        const j = judge({ mark: markFor(agent, c, check), trials: pick(r.trials.slice(0, cf)), extra, critical: criticalFor(agent, c, check), baseline: baseline[agent.id]?.[c.id]?.[check] || null, gap: gaps[`${agent.id}/${c.id}/${check}`] || 0, minPass: c.minPass ?? agent.CHECKS[check].minPass ?? null });
        if (j.verdict !== 'n/a') checks[check] = { ...j, title: agent.CHECKS[check].title };
      }
      const errors = r.trials.filter((t) => t.error).length;
      // What a person needs to judge a failure: the samples of failing trials.
      const failing = Object.entries(checks).filter(([, v]) => v.verdict === 'fail').map(([k]) => k);
      // A case "for reading" keeps every trial's sample (a whole lesson is read in full).
      const forReading = Object.values(checks).some((v) => v.verdict === 'reading');
      const samples = r.trials.filter((t) => !t.error && (forReading || failing.some((k) => t.checks?.[k] === false))).slice(0, forReading ? 12 : 3).map((t) => t.sample);
      cases.push({ agent: agent.id, id: c.id, title: c.title || c.reply || c.id, from: c.from || null, errors, checks, samples });
    }
  }
  return cases;
}

/** A worktree of `ref` to run the baseline from (removed afterwards). */
function baselineRoot(ref) {
  const sha = execFileSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' }).trim();
  const dir = join(REPO, '..', `.plato-eval-baseline-${sha.slice(0, 12)}`);
  if (!existsSync(dir)) execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd: REPO, stdio: 'ignore' });
  // Its server dependencies (the harness imports converse.js from this checkout, not the baseline's).
  return { dir, sha, cleanup: () => execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'ignore' }) };
}

function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } }

function readingPack(results) {
  const lines = [`# Reading pack: ${results.fingerprint} (${results.level})`, '', `Run ${results.startedAt} with ${results.model}. For the reading panel (docs/AGENT_EVALS.md section 4, "What the reading panel looks at"). Synthetic learners only.`, ''];
  for (const c of results.cases) {
    if (!c.samples?.length && !Object.values(c.checks).some((x) => x.verdict === 'reading')) continue;
    lines.push(`## ${c.agent} ${c.id}: ${c.title}`, '');
    for (const v of Object.values(c.checks)) if (v.verdict === 'fail') lines.push(`- **Failed:** ${v.title} (${v.fails} of ${v.n})`);
    for (const s of c.samples || []) lines.push('', '```', JSON.stringify(s, null, 2).slice(0, 4000), '```');
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const opt = args(process.argv.slice(2));
  const level = opt.level === 'full' ? 'full' : 'moments';
  let ids;
  if (opt.agents) ids = String(opt.agents).split(',').filter((a) => AGENTS.includes(a) || SUITES.includes(a));
  // A release: every agent, then the whole lessons and the chains.
  else if (level === 'full') ids = [...AGENTS, ...SUITES];
  else if (opt.affected) ids = affectedAgents(changedSince(REPO, opt.base));
  else ids = AGENTS;
  const fp = fingerprint(REPO);
  // Results belong to a commit. Uncommitted changes to what's evaluated make
  // a run that can't be matched to one: it is kept apart and the check ignores it.
  const dirty = uncommittedWatched(REPO);
  // Only some cases (--cases C61,W7): for checking a fix; it never counts.
  const only = opt.cases ? new Set(String(opt.cases).split(',')) : null;
  // Scratch runs get their own file: two at once at the same commit would overwrite each other.
  const outFile = dirty.length || only ? join(EVALS, 'scratch', `${fp}-${level}-${Date.now()}-${process.pid}.json`) : join(EVALS, 'results', `${fp}-${level}.json`);
  if (!ids.length) { console.log('Nothing the evaluations cover has changed.'); return 0; }
  if (dirty.length) process.stderr.write(`Note: uncommitted changes to ${dirty.join(', ')}. These results go to evals/scratch/ and won't count until you commit and run again.\n`);

  const agents = [];
  for (const id of ids) if (existsSync(join(here, SUITES.includes(id) ? 'suites' : 'agents', `${id}.js`))) agents.push(await loadAgent(id));
  const missing = ids.filter((id) => !agents.some((a) => a.id === id));
  if (only) for (const a of agents) a.cases = a.cases.filter((c) => only.has(c.id));
  const trials = Number(opt.trials);
  const concurrency = Number(opt.concurrency);
  const model = bedrockModel();
  const say = (t) => { if (!opt.quiet) process.stderr.write(t); };
  say(`Evaluating ${agents.map((a) => a.id).join(', ')} (${level}, ${trials} trials each)${missing.length ? `; not built yet: ${missing.join(', ')}` : ''}\n`);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Today's version, once per version of main (and agent set).
  let baselineDir = null;
  let cleanupBaseline = () => {};
  let baseline = {};
  let baselineInfo = null;
  if (!opt['no-baseline']) {
    const b = baselineRoot('origin/main');
    baselineDir = b.dir;
    cleanupBaseline = b.cleanup;
    try {
      // Today's version, measured by this harness: either changing means measuring again.
      const baseFp = `${fingerprint(b.dir)}-${harnessFingerprint(REPO)}`;
      const file = join(EVALS, 'baseline', `${baseFp}.json`);
      const cached = readJson(file, { tally: {}, agents: [] });
      const need = agents.filter((a) => !cached.agents.includes(a.id));
      if (need.length) {
        say(`Baseline (origin/main ${b.sha.slice(0, 7)}): ${need.map((a) => a.id).join(', ')}\n`);
        const bapp = await loadApp(b.dir);
        const raw = await runCases({ app: bapp, model, agents: need, trials, concurrency, progress: () => say('.') });
        say('\n');
        Object.assign(cached.tally, tally(raw));
        cached.agents = [...new Set([...cached.agents, ...need.map((a) => a.id)])];
        cached.main = b.sha;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(cached, null, 1));
      }
      baseline = cached.tally;
      baselineInfo = { main: cached.main || b.sha, fingerprint: baseFp, mainFingerprint: fingerprint(b.dir) };
      // Normal variation: today's version run twice (on purpose, --calibrate).
      if (opt.calibrate) {
        say('Calibrating: running today’s version again\n');
        const bapp = await loadApp(b.dir);
        const again = tally(await runCases({ app: bapp, model, agents, trials, concurrency, progress: () => say('.') }));
        say('\n');
        const cal = readJson(join(here, 'calibration.json'), {});
        const gaps = {};
        for (const [a, cs] of Object.entries(again)) for (const [id, checks] of Object.entries(cs)) for (const [k, v] of Object.entries(checks)) {
          const first = baseline[a]?.[id]?.[k];
          if (first?.n && v.n) gaps[`${a}/${id}/${k}`] = Math.abs(first.fails / first.n - v.fails / v.n);
        }
        // Keyed by main's version alone: normal variation is main's, and stays
        // valid while the harness changes around it.
        cal[fingerprint(b.dir)] = { main: b.sha, at: startedAt, gaps: { ...(cal[fingerprint(b.dir)]?.gaps || {}), ...gaps } };
        writeFileSync(join(here, 'calibration.json'), JSON.stringify(cal, null, 1));
      }
    } catch (e) { b.cleanup(); throw e; }
  }
  const gaps = baselineInfo ? readJson(join(here, 'calibration.json'), {})[baselineInfo.mainFingerprint]?.gaps || {} : {};

  say('Candidate (this checkout)\n');
  const app = await loadApp(REPO);
  const raw = await runCases({ app, model, agents, trials, concurrency, progress: () => say('.') });
  say('\n');
  let cases = score({ agents, raw, baseline, gaps });

  // A failed "at least as good as today", or a failed "never" that isn't
  // critical, is confirmed before it counts: the
  // case runs CONFIRM_TRIALS more times on both versions and is judged on all
  // the trials. Six trials can't tell a 25% rate from 0% (the Knowledge Base
  // Editor's K3: 0 of 6 on main, then 3 of 12). A real regression survives it.
  // Also a failed "never" that isn't critical (Blake, 2026-11-24).
  const toConfirm = cases.filter((c) => Object.entries(c.checks).some(([k, v]) => v.verdict === 'fail' && (v.mark === 'parity' || (v.mark === 'never' && !criticalFor(agents.find((a) => a.id === c.agent), agents.find((a) => a.id === c.agent).cases.find((x) => x.id === c.id), k)))));
  if (toConfirm.length && !opt['no-confirm']) {
    const sub = agents.map((a) => ({ ...a, cases: a.cases.filter((c) => toConfirm.some((x) => x.agent === a.id && x.id === c.id)) })).filter((a) => a.cases.length);
    say(`Confirming ${toConfirm.map((c) => `${c.agent} ${c.id}`).join(', ')}: ${CONFIRM_TRIALS} more trials each, on both versions\n`);
    const more = await runCases({ app, model, agents: sub, trials: CONFIRM_TRIALS, concurrency, progress: () => say('.'), exact: true });
    for (const [a, cs] of Object.entries(more)) for (const [id, r] of Object.entries(cs)) {
      raw[a][id].confirmFrom = raw[a][id].trials.length;
      raw[a][id].trials.push(...r.trials);
    }
    if (baselineDir) {
      const extra = tally(await runCases({ app: await loadApp(baselineDir), model, agents: sub, trials: CONFIRM_TRIALS, concurrency, progress: () => say('.'), exact: true }));
      for (const [a, cs] of Object.entries(extra)) for (const [id, checks] of Object.entries(cs)) for (const [k, v] of Object.entries(checks)) {
        const t = ((baseline[a] ||= {})[id] ||= {})[k] ||= { fails: 0, n: 0 };
        t.fails += v.fails; t.n += v.n;
      }
    }
    say('\n');
    cases = score({ agents, raw, baseline, gaps });
  }
  cleanupBaseline();
  const summary = runVerdict(cases);
  const errors = cases.reduce((n, c) => n + c.errors, 0);
  const results = {
    v: 1, fingerprint: fp, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), dirty: dirty.length > 0, level, agents: agents.map((a) => a.id), notBuilt: missing, model: model.id,
    baseline: baselineInfo, startedAt, took: Math.round((Date.now() - t0) / 1000), stats: model.stats, errors,
    ...summary, verdict: errors > cases.length ? 'error' : summary.verdict, cases,
  };
  mkdirSync(dirname(outFile), { recursive: true });
  mkdirSync(join(EVALS, 'reading'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  // A scratch run's reading pack stays with it, out of evals/reading/.
  writeFileSync(outFile.includes('/scratch/') ? outFile.replace(/\.json$/, '.md') : join(EVALS, 'reading', `${fp}-${level}.md`), readingPack(results));

  console.log(`\n${results.verdict.toUpperCase()}: ${summary.passed} passed, ${summary.failed} failed, ${summary.noBaseline} with no baseline yet, ${summary.pending} not yet expected (${cases.length} cases, ${model.stats.calls} model calls, ${results.took} s)`);
  for (const c of cases) for (const v of Object.values(c.checks)) {
    if (v.verdict === 'fail') console.log(`  FAIL ${c.agent} ${c.id}: ${v.title} — ${v.fails} of ${v.n}${v.baseRate != null ? ` (today ${Math.round(v.baseRate * 100)}%)` : ''}`);
  }
  console.log(`Results: ${outFile.replace(REPO + '/', '')}`);
  return results.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
