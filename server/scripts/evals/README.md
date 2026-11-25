# Agent evaluations

The tests in [`docs/AGENT_EVALS.md`](../../../docs/AGENT_EVALS.md), built. Each
case runs several times against plato's model (Bedrock, us-east-2), through
the app's own code, and every check is scored by its pass mark.

## Running

From `server/`, with an AWS login that can call Bedrock (`AWS_PROFILE`):

```bash
npm run eval -- --affected            # the agents your branch changes (what the hook runs)
npm run eval -- --agents coach        # one or more agents
npm run eval -- --level full          # every agent; whole lessons and chains as they're built (a release)
npm run eval -- --calibrate           # measure normal variation: today's version run twice
```

Options: `--trials 6`, `--concurrency 6`, `--base origin/playground`, `--no-baseline`, and `--cases C61,W7` to check a fix on some cases (written to `evals/scratch/`; it never counts).

It prints what failed, writes `evals/results/<version>-<level>.json` and a reading
pack in `evals/reading/`, and exits 1 on any failure. A run with uncommitted
changes to what's evaluated goes to `evals/scratch/` and doesn't count.

## Running automatically

`npm install` in `server/` sets `core.hooksPath` to `.githooks/`.
`.githooks/pre-push` runs `hook.js`:

- **What it runs:** the affected agents, or every agent at full level when pushing `playground`.
- **When:** whenever a push changes what's covered (`lib/watch.js`) and there are no passing results for the commit.
- **After a pass:** it commits the results and asks you to push again.
- **After a fail:** it stops the push.

Skip once with `EVAL_SKIP=1 git push`; the GitHub check still applies.

`.github/workflows/agent-evals.yml` runs `check.js` on every pull request. It
never calls the model, and fails unless there are passing results for the PR's
exact version: the affected agents into `playground`, every agent at full
level into `main`.

## How it's built

| Part | What it does |
|---|---|
| `run.js` | The CLI: picks agents, runs the baseline (today's `origin/main`, in a temporary worktree) and the candidate (this checkout), scores, writes results |
| `check.js`, `hook.js` | The decision the hook and the GitHub check share; the hook |
| `lib/app.js` | Loads one version of plato's code (candidate or baseline). Missing modules stay `undefined`, so an older version runs as it did |
| `lib/model.js` | The Bedrock Converse caller, and a stand-in for the harness's own tests |
| `lib/watch.js` | What's covered: which files affect which agents, and the version fingerprint |
| `lib/score.js` | The pass marks |
| `agents/<id>.js` | One module per agent: builds its real input, calls the model, checks the reply with the app's own parsers |
| `cases/<id>.json` | That agent's cases, from the spec |
| `fixtures/lessons.js` | The test lessons L1–L14 |
| `fixtures/learners.js`, `lib/learner.js` | The character cards and life stages; the simulated learner |
| `lib/coachTurn.js` | One Coach turn (and the opener) as the app runs it, shared by the single moments, whole lessons and chains |
| `suites/` | Whole lessons and chains: run only at the full level |

### Pass marks
- `never`: one failing trial fails, for a `critical` check (completing without the work, a recorded approval, a changed link or code, AI suspicion, a made-up fact). Any other `never` is confirmed first: the case runs 12 more times on both versions, and it fails only if it happens again or more often than on main (Blake, 2026-11-24).
- `parity`: no worse than today beyond normal variation. A failure is confirmed first: the case runs 12 more times on both versions and is judged on all the trials (`--no-confirm` skips this). With no baseline (an agent new in this version), the check's `minPass` applies.
- `reading`: collected for the reading panel.
- `pending`: "not yet expected"; reported, never blocks.

A case can set `mark: "pending"` (the whole case), `marks: { check: mark }`, or `minPass`.

### Results and the baseline
- Results are keyed by a hash of every covered file at the commit (git blob ids), so the hook and GitHub agree.
- The baseline is keyed by main's version and this harness's version, so changing a case or check measures today's version again.

## Adding a case
1. Add it to the agent's `cases/<id>.json` and to the spec, so reviewers see it.
2. Run `npm run eval -- --agents <id>`.

A case is never loosened to make a run pass without a person agreeing: if the agent is wrong, fix the agent.

## Built so far
- **Agents:** all eleven, as single moments: Coach, Assessor, Claim Check, Lesson Owner, Learner Profile Update and Owner, Course Progress Update, Lesson Creator, Lesson Extractor, Knowledge Base Editor and Extractor.
- **Whole lessons** (`suites/lessons.js`, full level): 36 lessons, one per trial. A simulated learner (`lib/learner.js`) plays a character card at a life stage (`fixtures/learners.js`), and every Coach turn goes through `lib/coachTurn.js`, the same pipeline as the single moments.
- **Chains** (`suites/chains.js`, full level): the spec's six handovers, 5 runs each.
- **Screenshots:** `fixtures/images/` holds small synthetic PNGs, used by A13 and by the simulated learners when a lesson asks for a screenshot.

`../coach-eval.js` stays for comparing models (`--models`); the Coach module here is what gates changes.
