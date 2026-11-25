// One-off: the Coach's single moments with different models playing every
// agent in the Coach's pipeline (Coach, Assessor, Claim Check), through the
// app's own code, scored by plato's checks and the independent judge.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { toConverseRequest, fromConverseResponse } from '/Users/uic-b3b/Repos/plato/.claude/worktrees/slack-link/server/src/lib/converse.js';
import { loadApp } from '/Users/uic-b3b/Repos/plato/.claude/worktrees/slack-link/server/scripts/evals/lib/app.js';
import { bedrockJudge } from '/Users/uic-b3b/Repos/plato/.claude/worktrees/slack-link/server/scripts/evals/lib/judge.js';
import { loadAgent } from '/Users/uic-b3b/Repos/plato/.claude/worktrees/slack-link/server/scripts/evals/run.js';
import { writeFileSync } from 'node:fs';

const TRIALS = Number(process.env.TRIALS || 4);
const MODELS = (process.env.MODELS || 'qwen.qwen3-vl-235b-a22b,us.anthropic.claude-haiku-5-5,us.anthropic.claude-sonnet-5-5').split(',');
function modelFor(modelId) {
  const client = new BedrockRuntimeClient({ region: 'us-east-2', retryMode: 'adaptive', maxAttempts: 6 });
  const stats = { calls: 0, ms: 0, inTokens: 0, outTokens: 0 };
  let noTemperature = false;
  return { id: modelId, stats, async call({ system, messages, maxTokens = 1024, temperature }) {
    const t0 = Date.now();
    const send = (temp) => client.send(new ConverseCommand(toConverseRequest(modelId, { system, messages, max_tokens: maxTokens, ...(temp != null ? { temperature: temp } : {}) })));
    let res;
    try { res = await send(noTemperature ? undefined : temperature); } catch (e) {
      if (!/temperature/i.test(String(e.message))) throw e;
      noTemperature = true; res = await send(undefined);
    }
    res = fromConverseResponse(res);
    stats.calls++; stats.ms += Date.now() - t0; stats.inTokens += res.usage?.input_tokens || 0; stats.outTokens += res.usage?.output_tokens || 0;
    return res.content.map((b) => b.text || '').join('');
  } };
}
async function pool(jobs, n) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; try { out[k] = await jobs[k](); } catch (e) { out[k] = { error: String(e.message).slice(0, 160) }; } } })); return out; }

const app = await loadApp('/Users/uic-b3b/Repos/plato/.claude/worktrees/slack-link');
const coach = await loadAgent('coach');
const judge = bedrockJudge();
const cases = coach.cases.filter((c) => c.mark !== 'pending');
const report = {};
for (const id of MODELS) {
  const model = modelFor(id);
  const t0 = Date.now();
  const jobs = cases.flatMap((c) => Array.from({ length: TRIALS }, () => async () => ({ id: c.id, ...(await coach.run(c, { app, model, judge })) })));
  const out = await pool(jobs, 8);
  const tally = {}; let errors = 0; const errSample = [];
  for (const r of out) { if (r.error) { errors++; if (errSample.length < 3) errSample.push(r.error); continue; } for (const [k, v] of Object.entries(r.checks)) { if (v === null) continue; (tally[k] ||= { fails: 0, n: 0 }).n++; if (v === false) tally[k].fails++; } }
  report[id] = { turns: out.length - errors, errors, errSample, tally, secondsPerTurn: +(((Date.now() - t0) / 1000) * 8 / out.length).toFixed(1), calls: model.stats.calls, callsPerTurn: +(model.stats.calls / Math.max(1, out.length - errors)).toFixed(1), inTokens: model.stats.inTokens, outTokens: model.stats.outTokens, gave: out.filter((r) => r.sample?.gaveAnswer).slice(0, 6).map((r) => `${r.id}: ${String(r.sample.gaveAnswer).slice(0, 160)}`) };
  console.log(id, JSON.stringify(report[id].tally));
  writeFileSync('/tmp/compare-models.json', JSON.stringify(report, null, 1));
}
console.log('done');
