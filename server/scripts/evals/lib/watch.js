/**
 * What the evaluations cover: which files can change how which agents
 * behave. A change to a watched file runs the evaluations for the agents it
 * affects (the pre-push hook, run.js --affected), and the GitHub check
 * requires passing results for the version that changed it.
 *
 * Results are keyed by `fingerprint()`: a hash of every watched file's
 * contents. Change any of them and the results no longer match. The results
 * themselves (`evals/`) aren't watched, so committing them doesn't.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const AGENTS = [
  'coach', 'assessor', 'claim-check', 'lesson-owner', 'learner-profile-update', 'learner-profile-owner',
  'course-progress-update', 'lesson-creator', 'lesson-extractor', 'knowledge-base-editor', 'knowledge-base-extractor',
];
/** Run only at the full level (a release): the whole lessons and the chains (suites/). */
export const SUITES = ['lessons', 'chains'];
const AUTHORING = ['lesson-creator', 'lesson-extractor', 'knowledge-base-editor', 'knowledge-base-extractor'];
const PROFILE = ['learner-profile-update', 'learner-profile-owner'];

/**
 * `[pattern, agents]`, in order; a file takes the agents of every pattern it
 * matches. 'all' is every agent: the model, how prompts are put together, how
 * replies are read back, and the harness itself.
 */
export const COVERAGE = [
  // An agent's own instructions. The Coach runs with the Assessor and Claim
  // Check behind it, so their instructions change the Coach's results too.
  [/^client\/prompts\/(coach|assessor|claim-check)\.md$/, ['coach', 'assessor', 'claim-check']],
  [/^client\/prompts\/([a-z-]+)\.md$/, (m) => (AGENTS.includes(m[1]) ? [m[1]] : [])],
  [/^client\/js\/(promptAssembly|orchestrator|language|agentHeader)\.js$/, 'all'],
  [/^client\/src\/lib\/constants\.js$/, 'all'],
  [/^server\/src\/lib\/(converse|ai-provider)\.js$/, 'all'],
  [/^client\/src\/lib\/(lessonEngine|assessment)\.js$/, ['coach', 'assessor', 'claim-check', 'lesson-owner']],
  [/^client\/src\/lib\/lessonWork\.js$/, ['coach']],
  [/^client\/js\/validators\.js$/, ['coach', 'lesson-owner']],
  [/^client\/js\/learnerNoteFilter\.js$/, PROFILE],
  [/^client\/src\/lib\/profileQueue\.js$/, PROFILE],
  [/^client\/src\/lib\/courseProgressQueue\.js$/, ['course-progress-update']],
  [/^client\/src\/lib\/(lessonCreationEngine|authoringEngine)\.js$/, AUTHORING],
  [/^server\/src\/lib\/lesson-markdown\.js$/, ['lesson-extractor']],
  // The harness: an agent's module and cases are that agent; the rest is everyone.
  [/^server\/scripts\/evals\/(agents|cases)\/([a-z-]+)\.(js|json)$/, (m) => (AGENTS.includes(m[2]) ? [m[2]] : [])],
  [/^server\/scripts\/evals\/(lib|fixtures|suites|run\.js)/, 'all'],
  [/^server\/scripts\/evals\/cases\/(lessons|chains)\.json$/, 'all'],
];

/** The agents a set of changed files affects. */
export function affectedAgents(files) {
  const out = new Set();
  for (const f of files) {
    for (const [re, agents] of COVERAGE) {
      const m = f.match(re);
      if (!m) continue;
      const list = agents === 'all' ? AGENTS : typeof agents === 'function' ? agents(m) : agents;
      for (const a of list) out.add(a);
    }
  }
  return AGENTS.filter((a) => out.has(a));
}

/** True when a file is one the evaluations cover. */
export const isWatched = (f) => COVERAGE.some(([re]) => re.test(f));

/**
 * A hash of every watched file at a commit (path and git blob id): the
 * version the results are for. Committed content, so the hook and the GitHub
 * check compute the same value for the same commit.
 */
export function fingerprint(root, rev = 'HEAD') {
  const tree = execFileSync('git', ['ls-tree', '-r', rev], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const h = createHash('sha256');
  for (const line of tree.split('\n').filter(Boolean).sort()) {
    const [meta, path] = line.split('\t');
    if (isWatched(path)) { h.update(path); h.update('\0'); h.update(meta.split(' ')[2]); h.update('\0'); }
  }
  return h.digest('hex').slice(0, 16);
}

/** A hash of the harness itself (its code, cases and fixtures) at a commit: a baseline is only reusable with the same harness. */
export function harnessFingerprint(root, rev = 'HEAD') {
  const tree = execFileSync('git', ['ls-tree', '-r', rev, '--', 'server/scripts/evals'], { cwd: root, encoding: 'utf8' });
  return createHash('sha256').update(tree.split('\n').sort().join('\n')).digest('hex').slice(0, 12);
}

/** Watched files with changes not yet committed (a run on them can't be matched to a commit). */
export function uncommittedWatched(root) {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  return out.map((l) => l.slice(3).split(' -> ').pop()).filter(isWatched);
}

/** Files changed between `base` and the working tree (committed or not). */
export function changedSince(root, base) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return [...new Set([...run(['diff', '--name-only', mergeBase]), ...run(['ls-files', '--others', '--exclude-standard'])])];
}
