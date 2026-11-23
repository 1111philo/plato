#!/usr/bin/env node
/**
 * Coach eval (#584): does the coach hold learners to the objectives?
 *
 * Replays one coach turn per scenario (coach-eval/scenarios.js) against
 * Bedrock, through plato's own code: buildContext, the system-prompt
 * assembly, parseCoachResponse, the grading check, and the completion rule.
 * Three modes, so each change can be measured on its own:
 *
 *   baseline  coach.md at --baseline-ref, old assembly; a 10 completes the lesson
 *   prompt    this checkout's coach.md and assembly; a 10 completes the lesson
 *   harness   prompt + the grading check + "every objective checked off" (what plato runs)
 *
 * Usage (from server/, with AWS credentials that can call Bedrock in us-east-2):
 *   node scripts/coach-eval.js [--modes baseline,prompt,harness] [--models qwen.qwen3-vl-235b-a22b,…]
 *     [--trials 5] [--kb kb.json|kb.md] [--catalog lessons.txt] [--baseline-ref origin/main]
 *     [--scenario id] [--json out.json] [--concurrency 4]
 *
 * --kb: a classroom's program knowledge base (JSON `{ content }` or markdown).
 * The coach always gets it in plato, and a long one is part of the problem,
 * so pass your classroom's. Nothing is written anywhere but --json.
 *
 * Costs a few cents per run on Qwen3-VL. This calls Bedrock directly (not
 * the /v1/ai proxy, which only allows plato's model) so other models can be
 * compared; plato itself still runs one model (CLAUDE.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { toConverseRequest, fromConverseResponse } from '../src/lib/converse.js';
import { SCENARIOS, scenarioState } from './coach-eval/scenarios.js';

// The engine is client code; it loads in Node with these stubs (as its tests do).
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.fetch ??= async () => ({ ok: false, status: 404, json: async () => ({}) });

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const client = (p) => join(repo, 'client', p);
const { buildContext, parseCoachResponse, recoverMissingTags, applyCoachResponseToKB, checkGrading } = await import(client('src/lib/lessonEngine.js'));
const { TAG_REPAIR_ADDENDUM, TAG_REPAIR_CUE } = await import(client('js/orchestrator.js'));
const { mergeObjectivesMet } = await import(client('src/lib/lessonWork.js'));
const { assessmentPlan, draftsForLearner, claimsCompletion, DRAFT_ADDENDUM } = await import(client('src/lib/assessment.js'));
const { assembleSystemPrompt, COACH_KB_NOTE } = await import(client('js/promptAssembly.js'));

function args(argv) {
  const out = { modes: 'baseline,prompt,harness', models: 'qwen.qwen3-vl-235b-a22b', trials: '5', 'baseline-ref': 'origin/main', concurrency: '4' };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? 'true' : argv[++i];
  return out;
}
const opt = args(process.argv.slice(2));

function readKb(path) {
  if (!path) return '';
  const raw = readFileSync(path, 'utf8');
  try { const j = JSON.parse(raw); return j.content ?? j.data?.content ?? raw; } catch { return raw; }
}
const KB = readKb(opt.kb);
const CATALOG = opt.catalog ? readFileSync(opt.catalog, 'utf8').trim()
  : SCENARIOS.map((s) => s.lesson).filter((v, i, a) => a.indexOf(v) === i).map((k) => `- ${k}`).join('\n');
const PROMPTS = {
  current: readFileSync(client('prompts/coach.md'), 'utf8'),
  baseline: execFileSync('git', ['show', `${opt['baseline-ref']}:client/prompts/coach.md`], { cwd: repo, encoding: 'utf8' }),
  assessor: readFileSync(client('prompts/assessor.md'), 'utf8'),
  claimCheck: readFileSync(client('prompts/claim-check.md'), 'utf8'),
};

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-2', retryMode: 'adaptive', maxAttempts: 4 });
async function converse(modelId, system, messages, maxTokens, stats, temperature) {
  const t0 = Date.now();
  const res = fromConverseResponse(await bedrock.send(new ConverseCommand(toConverseRequest(modelId, { system, messages, max_tokens: maxTokens, ...(temperature != null ? { temperature } : {}) }))));
  stats.calls++; stats.ms += Date.now() - t0;
  stats.inTokens += res.usage.input_tokens; stats.outTokens += res.usage.output_tokens;
  return res.content.map((b) => b.text).join('');
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
// A quoted passage of 15+ words: the coach wrote the learner's text for them.
const LONG_QUOTE = /["“]([^"”]{0,600})["”]/g;
const draftedForLearner = (text) => [...text.matchAll(LONG_QUOTE)].some((m) => m[1].trim().split(/\s+/).length >= 15);
const wordCount = (t) => t.trim().split(/\s+/).filter(Boolean).length;

async function runTurn(mode, modelId, s) {
  const { lesson, lessonKB } = scenarioState(s);
  const stats = { calls: 0, ms: 0, inTokens: 0, outTokens: 0 };
  const messages = [
    { role: 'user', content: buildContext(lesson, lessonKB, 'No profile yet', 'Sam') },
    { role: 'assistant', content: 'Ready.' },
    ...s.history,
    { role: 'user', content: s.message },
  ];
  const system = (addendum = '') => assembleSystemPrompt(mode === 'baseline'
    ? { prompt: PROMPTS.baseline, kb: KB, catalog: CATALOG, addendum }
    : { prompt: PROMPTS.current, kb: KB, kbNote: COACH_KB_NOTE, catalog: CATALOG, addendum });

  // As the app does: a reply missing its tags gets one repair call (lessonEngine.recoverMissingTags).
  const first = parseCoachResponse(await converse(modelId, system(), messages, 2048, stats));
  let parsed = await recoverMissingTags(first, () => converse(modelId, system(TAG_REPAIR_ADDENDUM),
    [...messages, { role: 'assistant', content: first.text || '…' }, { role: 'user', content: TAG_REPAIR_CUE }], 600, stats));
  // The draft guard, as sendMessage runs it (harness only).
  let draftRewritten = false;
  const firstDrafted = draftsForLearner(parsed.text || '');
  if (mode === 'harness' && firstDrafted) {
    const raw = await converse(modelId, system(DRAFT_ADDENDUM), messages, 2048, stats);
    const again = await recoverMissingTags(parseCoachResponse(raw), () => converse(modelId, system(TAG_REPAIR_ADDENDUM),
      [...messages, { role: 'assistant', content: parseCoachResponse(raw).text || '…' }, { role: 'user', content: TAG_REPAIR_CUE }], 600, stats));
    if (again.text && !draftsForLearner(again.text)) { parsed = again; draftRewritten = true; }
  }
  // What the coach itself checked off this turn, before any check.
  const claimed = assessmentPlan(lessonKB, parsed).claimed.length;
  let assessment = null;
  let assessRaw = null;
  if (mode === 'harness') {
    const graded = await checkGrading({
      lesson, kb: lessonKB, parsed, messages,
      assess: async (input) => { try { return (assessRaw = await converse(modelId, PROMPTS.assessor, [{ role: 'user', content: input }], 2048, stats, 0)); } catch (e) { assessRaw = `ERROR ${e.name}: ${e.message}`; throw e; } },
      regenerate: (addendum) => converse(modelId, system(addendum), messages, 2048, stats),
      judgeClaim: async (t) => /^\s*yes/i.test(await converse(modelId, PROMPTS.claimCheck, [{ role: 'user', content: t }], 5, stats, 0)),
    });
    parsed = graded.parsed;
    assessment = graded.assessment;
  }
  const merged = mergeObjectivesMet(lessonKB, parsed.kbUpdate);
  const completed = mode === 'harness'
    ? applyCoachResponseToKB(merged, parsed).achieved
    : Number(parsed.progress) >= 10; // the rule before #584
  const text = parsed.text || '';
  const newlyMet = (merged.objectivesMet || []).length - (lessonKB.objectivesMet || []).length;
  return {
    claimed, newlyMet,
    mode, model: modelId, scenario: s.id, expectComplete: s.expect.complete,
    completed, correct: completed === s.expect.complete,
    progress: parsed.progress ?? null, tagsMissing: parsed.progress == null, tagsRepaired: !!parsed.tagsRepairTried,
    portfolio: !!s.expect.noPortfolio && /portfolio/i.test(text),
    drafted: !!s.expect.noDraft && draftedForLearner(text),
    draftedAny: draftsForLearner(text), firstDrafted, draftRewritten,
    saysDoneButOpen: !completed && claimsCompletion(text),
    replaced: !!assessment?.replaced,
    cjk: CJK.test(text), words: wordCount(text),
    held: !!assessment?.held, regenerated: !!assessment?.regenerated, checkFailed: !!assessment?.failed,
    ...stats, text, assessRaw,
  };
}

async function pool(jobs, n) {
  const out = []; let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const j = i++;
      try { out[j] = await jobs[j](); } catch (e) { out[j] = { error: e.name || e.message, ...jobs[j].meta }; }
      process.stderr.write('.');
    }
  });
  await Promise.all(workers);
  process.stderr.write('\n');
  return out;
}

const modes = opt.modes.split(',');
const models = opt.models.split(',');
const scenarios = opt.scenario ? SCENARIOS.filter((s) => s.id === opt.scenario) : SCENARIOS;
const jobs = [];
for (const mode of modes) for (const model of models) for (const s of scenarios) for (let t = 0; t < Number(opt.trials); t++) {
  const job = () => runTurn(mode, model, s);
  job.meta = { mode, model, scenario: s.id };
  jobs.push(job);
}
console.error(`${jobs.length} turns (${modes.join(', ')} × ${models.length} model(s) × ${scenarios.length} scenarios × ${opt.trials}); KB ${KB.length} chars`);
const results = await pool(jobs, Number(opt.concurrency));
if (opt.json) writeFileSync(opt.json, JSON.stringify(results, null, 1));

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
for (const model of models) for (const mode of modes) {
  const rs = results.filter((r) => r.mode === mode && r.model === model);
  const ok = rs.filter((r) => !r.error);
  const shouldNot = ok.filter((r) => !r.expectComplete);
  const should = ok.filter((r) => r.expectComplete);
  console.log(`\n${model} · ${mode}  (${ok.length} turns, ${rs.length - ok.length} errors)`);
  console.log(`  false completions  ${shouldNot.filter((r) => r.completed).length}/${shouldNot.length}   (lower is better)`);
  console.log(`  missed completions ${should.filter((r) => !r.completed).length}/${should.length}   (lower is better)`);
  const port = ok.filter((r) => SCENARIOS.find((s) => s.id === r.scenario)?.expect.noPortfolio);
  const draft = ok.filter((r) => SCENARIOS.find((s) => s.id === r.scenario)?.expect.noDraft);
  console.log(`  portfolio drift    ${port.filter((r) => r.portfolio).length}/${port.length}`);
  console.log(`  wrote it for them  ${draft.filter((r) => r.drafted).length}/${draft.length}   any reply drafting: ${ok.filter((r) => r.draftedAny).length}/${ok.length} (first reply ${ok.filter((r) => r.firstDrafted).length}, rewritten ${ok.filter((r) => r.draftRewritten).length})`);
  console.log(`  says done, lesson open ${ok.filter((r) => r.saysDoneButOpen).length}/${ok.length}   (plato's words replaced ${ok.filter((r) => r.replaced).length})`);
  const thin = ok.filter((r) => SCENARIOS.find((s) => s.id === r.scenario)?.expect.noNewObjectives);
  console.log(`  checked off on a vague answer: coach ${thin.filter((r) => r.claimed > 0).length}/${thin.length}, kept ${thin.filter((r) => r.newlyMet > 0).length}/${thin.length}`);
  console.log(`  objectives: coach checked off ${ok.reduce((a, r) => a + r.claimed, 0)}, kept ${ok.reduce((a, r) => a + Math.max(0, r.newlyMet), 0)}`);
  console.log(`  mixed-in CJK       ${ok.filter((r) => r.cjk).length}/${ok.length}   tags repaired ${ok.filter((r) => r.tagsRepaired).length}, still missing ${ok.filter((r) => r.tagsMissing).length}`);
  console.log(`  reply words p50    ${median(ok.map((r) => r.words))}   calls/turn ${(ok.reduce((a, r) => a + r.calls, 0) / (ok.length || 1)).toFixed(2)}   turn ms p50 ${median(ok.map((r) => r.ms))}`);
  if (mode === 'harness') console.log(`  held ${ok.filter((r) => r.held).length}, second tries ${ok.filter((r) => r.regenerated).length}, check failed ${ok.filter((r) => r.checkFailed).length}`);
  for (const s of scenarios) {
    const x = ok.filter((r) => r.scenario === s.id);
    console.log(`    ${s.id.padEnd(24)} expect ${s.expect.complete ? 'complete' : 'open    '}  completed ${x.filter((r) => r.completed).length}/${x.length}  progress [${x.map((r) => r.progress ?? '–').join(' ')}]  correct ${pct(x.filter((r) => r.correct).length, x.length)}`);
  }
}
