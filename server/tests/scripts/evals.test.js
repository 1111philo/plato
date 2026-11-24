/**
 * The evaluation harness itself (server/scripts/evals), with a stand-in
 * model: no Bedrock calls. Checks the pass marks score as the spec says, the
 * coverage map sends a change to the right agents, results are keyed to the
 * exact version, and an agent run scores a bad answer as a failure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judge, runVerdict } from '../../scripts/evals/lib/score.js';
import { affectedAgents, fingerprint, AGENTS } from '../../scripts/evals/lib/watch.js';
import { loadApp } from '../../scripts/evals/lib/app.js';
import { stubModel } from '../../scripts/evals/lib/model.js';
import { loadAgent, runCases, score, tally, REPO } from '../../scripts/evals/run.js';

describe('pass marks', () => {
  it('"must never happen": one failing trial fails', () => {
    assert.equal(judge({ mark: 'never', trials: [true, true, false] }).verdict, 'fail');
    assert.equal(judge({ mark: 'never', trials: [true, true, null] }).verdict, 'pass');
  });
  it('"at least as good as today": fails only when worse than the baseline beyond normal variation', () => {
    const base = { fails: 1, n: 6 };
    assert.equal(judge({ mark: 'parity', trials: [true, true, true, true, true, false], baseline: base }).verdict, 'pass');
    assert.equal(judge({ mark: 'parity', trials: Array(30).fill(false), baseline: { fails: 0, n: 30 } }).verdict, 'fail');
    // A calibrated gap widens the allowance.
    assert.equal(judge({ mark: 'parity', trials: [false, false, true, true, true, true], baseline: { fails: 0, n: 6 }, gap: 0.5 }).verdict, 'pass');
  });
  it('with no baseline, a minimum pass rate applies if given, else it is reported', () => {
    assert.equal(judge({ mark: 'parity', trials: [true, false, false], minPass: 0.8 }).verdict, 'fail');
    assert.equal(judge({ mark: 'parity', trials: [true, true, true, true, false], minPass: 0.8 }).verdict, 'pass');
    assert.equal(judge({ mark: 'parity', trials: [false] }).verdict, 'no-baseline');
  });
  it('"for reading" and "not yet expected" never fail a run', () => {
    assert.equal(judge({ mark: 'pending', trials: [false, false] }).verdict, 'pending');
    assert.equal(judge({ mark: 'reading', trials: [false] }).verdict, 'reading');
    assert.equal(runVerdict([{ checks: { a: { verdict: 'pending' }, b: { verdict: 'pass' } } }]).verdict, 'pass');
    assert.equal(runVerdict([{ checks: { a: { verdict: 'fail' } } }]).verdict, 'fail');
  });
});

describe('what the evaluations cover', () => {
  it('a change runs the agents it can affect, and nothing else', () => {
    assert.deepEqual(affectedAgents(['client/prompts/lesson-owner.md']), ['lesson-owner']);
    assert.deepEqual(affectedAgents(['client/prompts/assessor.md']), ['coach', 'assessor', 'claim-check'], 'the Coach runs with the Assessor behind it');
    assert.deepEqual(affectedAgents(['server/src/lib/ai-provider.js']), AGENTS, 'the model is every agent');
    assert.deepEqual(affectedAgents(['client/js/promptAssembly.js']), AGENTS);
    assert.deepEqual(affectedAgents(['docs/ARCHITECTURE.md', 'client/src/components/chat/TraceTimeline.jsx', 'evals/results/x.json']), []);
    assert.deepEqual(affectedAgents(['server/scripts/evals/cases/claim-check.json']), ['claim-check']);
  });
  it('results are keyed to the exact version of everything they cover', () => {
    assert.match(fingerprint(REPO), /^[0-9a-f]{16}$/);
    assert.equal(fingerprint(REPO), fingerprint(REPO), 'stable');
  });
});

describe('an agent run, scored', () => {
  it('Claim Check: right answers pass; a wrong or unreadable answer fails its checks', async () => {
    const app = await loadApp(REPO);
    const agent = await loadAgent('claim-check');
    const only = { ...agent, cases: agent.cases.filter((c) => ['Y1', 'N1'].includes(c.id)) };
    const right = stubModel(({ messages }) => (/completed this lesson/.test(messages[0].content) ? 'YES' : 'NO'));
    const good = score({ agents: [only], raw: await runCases({ app, model: right, agents: [only], trials: 3, concurrency: 2 }) });
    assert.ok(good.every((c) => Object.values(c.checks).every((x) => x.verdict !== 'fail')));
    const wrong = stubModel(() => 'Maybe');
    const bad = score({ agents: [only], raw: await runCases({ app, model: wrong, agents: [only], trials: 3, concurrency: 2 }) });
    assert.equal(bad.find((c) => c.id === 'Y1').checks.answered.verdict, 'fail', '"must never happen": not yes or no');
    assert.equal(bad.find((c) => c.id === 'Y1').checks.correct.verdict, 'fail');
  });
  it('the baseline tally compares like with like', async () => {
    const raw = { a: { x: { trials: [{ checks: { k: true } }, { checks: { k: false } }, { checks: { k: null } }] } } };
    assert.deepEqual(tally(raw), { a: { x: { k: { fails: 1, n: 2 } } } });
  });
});

describe('the check (hook and GitHub)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { decide } = await import('../../scripts/evals/check.js');
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'plato-evals-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'base'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't');
    mkdirSync(join(dir, 'client/prompts'), { recursive: true }); mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'client/prompts/lesson-owner.md'), 'one'); writeFileSync(join(dir, 'docs/x.md'), 'a');
    git('add', '-A'); git('commit', '-q', '-m', 'base'); git('checkout', '-q', '-b', 'work');
    return { dir, git, write: (f, t) => { writeFileSync(join(dir, f), t); git('add', '-A'); git('commit', '-q', '-m', f); } };
  };
  const results = (dir, fp, extra = {}) => {
    mkdirSync(join(dir, 'evals/results'), { recursive: true });
    writeFileSync(join(dir, `evals/results/${fp}-moments.json`), JSON.stringify({ verdict: 'pass', agents: ['lesson-owner'], passed: 3, cases: [], ...extra }));
  };

  it('a change to nothing evaluated needs no results', () => {
    const r = repo(); r.write('docs/x.md', 'b');
    assert.equal(decide({ root: r.dir, base: 'base' }).ok, true);
  });
  it('a changed prompt needs passing results for exactly that version, and a later change makes them stale', () => {
    const r = repo(); r.write('client/prompts/lesson-owner.md', 'two');
    const missing = decide({ root: r.dir, base: 'base' });
    assert.equal(missing.ok, false); assert.deepEqual(missing.affected, ['lesson-owner']); assert.ok(missing.missing);
    results(r.dir, missing.fingerprint);
    assert.equal(decide({ root: r.dir, base: 'base' }).ok, true);
    r.write('client/prompts/lesson-owner.md', 'three');
    assert.equal(decide({ root: r.dir, base: 'base' }).ok, false, 'stale');
  });
  it('failing results, or results that miss an affected agent, don’t pass', () => {
    const r = repo(); r.write('client/prompts/lesson-owner.md', 'two');
    const { fingerprint: fp } = decide({ root: r.dir, base: 'base' });
    results(r.dir, fp, { verdict: 'fail', failed: 1 });
    assert.match(decide({ root: r.dir, base: 'base' }).reason, /failed/);
    results(r.dir, fp, { agents: ['coach'] });
    assert.match(decide({ root: r.dir, base: 'base' }).reason, /don’t cover lesson-owner/);
  });
  it('a release (full level) needs every agent, from a full run', () => {
    const r = repo(); r.write('client/prompts/lesson-owner.md', 'two');
    const { fingerprint: fp } = decide({ root: r.dir, base: 'base' });
    results(r.dir, fp);
    assert.equal(decide({ root: r.dir, base: 'base', level: 'full' }).ok, false, 'a moments run isn’t a release run');
  });
});
