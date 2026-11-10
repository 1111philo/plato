#!/usr/bin/env node
/**
 * CloudWatch picture of a load-test window: Lambda (concurrency, invocations,
 * errors, throttles, duration, cold starts from REPORT lines), DynamoDB per
 * table (throttles, latency, consumed capacity), Bedrock for plato's model,
 * and plato's own error codes from the logs.
 *
 *   node scripts/loadtest/cw.mjs <startISO> <endISO>
 *
 * Env: STACK (default plato-playground; refuses `plato`), AWS_PROFILE, AWS_REGION.
 * Uses the aws CLI. Bedrock metrics are per model for the whole account, so
 * other traffic on the same model (prod) shows up there too.
 */
import { execFileSync } from 'node:child_process';

const [start, end] = process.argv.slice(2);
if (!start || !end) { console.error('usage: cw.mjs <startISO> <endISO>'); process.exit(1); }
const STACK = process.env.STACK || 'plato-playground';
if (STACK === 'plato') { console.error('Refusing the prod stack.'); process.exit(1); }
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8', maxBuffer: 64 << 20 }));

const res = aws('cloudformation', 'describe-stack-resources', '--stack-name', STACK).StackResources;
const fn = (id) => res.find((r) => r.LogicalResourceId === id).PhysicalResourceId;
const tables = res.filter((r) => r.ResourceType === 'AWS::DynamoDB::Table').map((r) => r.PhysicalResourceId);

let qid = 0;
const q = (ns, metric, dims, stat) => ({
  Id: `m${qid++}`,
  MetricStat: { Metric: { Namespace: ns, MetricName: metric, Dimensions: Object.entries(dims).map(([Name, Value]) => ({ Name, Value })) }, Period: 60, Stat: stat },
  ReturnData: true,
});
const queries = [];
const label = new Map();
const add = (name, ...a) => { const x = q(...a); label.set(x.Id, name); queries.push(x); };
for (const id of ['PlatoStreamFunction', 'PlatoApiFunction']) {
  const FunctionName = fn(id);
  add(`${id} ConcurrentExecutions (max/min)`, 'AWS/Lambda', 'ConcurrentExecutions', { FunctionName }, 'Maximum');
  add(`${id} Invocations (sum/min)`, 'AWS/Lambda', 'Invocations', { FunctionName }, 'Sum');
  add(`${id} Errors (sum/min)`, 'AWS/Lambda', 'Errors', { FunctionName }, 'Sum');
  add(`${id} Throttles (sum/min)`, 'AWS/Lambda', 'Throttles', { FunctionName }, 'Sum');
  add(`${id} Duration p50`, 'AWS/Lambda', 'Duration', { FunctionName }, 'p50');
  add(`${id} Duration p99`, 'AWS/Lambda', 'Duration', { FunctionName }, 'p99');
}
for (const TableName of tables) {
  add(`${TableName} ThrottledRequests`, 'AWS/DynamoDB', 'ThrottledRequests', { TableName }, 'Sum');
  add(`${TableName} ConsumedRCU (sum/min)`, 'AWS/DynamoDB', 'ConsumedReadCapacityUnits', { TableName }, 'Sum');
  add(`${TableName} ConsumedWCU (sum/min)`, 'AWS/DynamoDB', 'ConsumedWriteCapacityUnits', { TableName }, 'Sum');
  for (const Operation of ['GetItem', 'Query', 'PutItem', 'UpdateItem']) {
    add(`${TableName} ${Operation} latency avg`, 'AWS/DynamoDB', 'SuccessfulRequestLatency', { TableName, Operation }, 'Average');
    add(`${TableName} ${Operation} latency max`, 'AWS/DynamoDB', 'SuccessfulRequestLatency', { TableName, Operation }, 'Maximum');
  }
}
const ModelId = 'qwen.qwen3-vl-235b-a22b';
add('Bedrock Invocations (sum/min)', 'AWS/Bedrock', 'Invocations', { ModelId }, 'Sum');
add('Bedrock InvocationThrottles', 'AWS/Bedrock', 'InvocationThrottles', { ModelId }, 'Sum');
add('Bedrock InvocationClientErrors', 'AWS/Bedrock', 'InvocationClientErrors', { ModelId }, 'Sum');
add('Bedrock InvocationServerErrors', 'AWS/Bedrock', 'InvocationServerErrors', { ModelId }, 'Sum');
add('Bedrock InvocationLatency p50', 'AWS/Bedrock', 'InvocationLatency', { ModelId }, 'p50');
add('Bedrock InvocationLatency p99', 'AWS/Bedrock', 'InvocationLatency', { ModelId }, 'p99');
add('Bedrock TimeToFirstToken p50', 'AWS/Bedrock', 'TimeToFirstToken', { ModelId }, 'p50');
add('Bedrock TimeToFirstToken p99', 'AWS/Bedrock', 'TimeToFirstToken', { ModelId }, 'p99');
add('Bedrock InputTokenCount (sum/min)', 'AWS/Bedrock', 'InputTokenCount', { ModelId }, 'Sum');
add('Bedrock OutputTokenCount (sum/min)', 'AWS/Bedrock', 'OutputTokenCount', { ModelId }, 'Sum');

const results = [];
for (let i = 0; i < queries.length; i += 400) {
  const r = aws('cloudwatch', 'get-metric-data', '--start-time', start, '--end-time', end, '--metric-data-queries', JSON.stringify(queries.slice(i, i + 400)));
  results.push(...r.MetricDataResults);
}
console.log('## Metrics (per-minute values over the window: max of the minutes, and total where it is a sum)\n');
console.log('| Metric | max/min | total | minutes |\n|---|---|---|---|');
for (const r of results) {
  const name = label.get(r.Id);
  if (!r.Values.length) continue;
  const max = Math.max(...r.Values);
  const sum = r.Values.reduce((a, b) => a + b, 0);
  if (max === 0 && /Throttle|Error/.test(name)) { console.log(`| ${name} | 0 | 0 | ${r.Values.length} |`); continue; }
  console.log(`| ${name} | ${+max.toFixed(1)} | ${/sum|Throttle|Error/.test(name) ? Math.round(sum) : ''} | ${r.Values.length} |`);
}

// Logs Insights: cold starts and plato's coded errors.
function insights(group, query) {
  const s = Math.floor(Date.parse(start) / 1000); const e = Math.ceil(Date.parse(end) / 1000);
  const { queryId } = aws('logs', 'start-query', '--log-group-name', group, '--start-time', String(s), '--end-time', String(e), '--query-string', query);
  for (;;) {
    const r = aws('logs', 'get-query-results', '--query-id', queryId);
    if (['Complete', 'Failed', 'Cancelled'].includes(r.status)) return r.results.map((row) => Object.fromEntries(row.map((f) => [f.field, f.value])));
    execFileSync('sleep', ['2']);
  }
}
for (const id of ['PlatoStreamFunction', 'PlatoApiFunction']) {
  const group = `/aws/lambda/${fn(id)}`;
  try {
    const cold = insights(group, `filter @type = "REPORT" | stats count(*) as invocations, count(@initDuration) as coldStarts, pct(@initDuration, 50) as initP50, pct(@initDuration, 99) as initP99, max(@initDuration) as initMax, pct(@duration, 50) as durP50, pct(@duration, 99) as durP99, max(@maxMemoryUsed)/1000000 as maxMemMB`);
    console.log(`\n## ${id} REPORT lines\n`, JSON.stringify(cold[0] || {}));
    const codes = insights(group, `filter @message like /"level":"(error|warn)"/ | parse @message '"code":"*"' as code | stats count(*) as n by code | sort n desc | limit 20`);
    console.log(`${id} error/warn codes:`, JSON.stringify(codes));
    const timeouts = insights(group, `filter @message like /Task timed out|Runtime.ExitError|ThrottlingException|ProvisionedThroughputExceeded/ | stats count(*) as n`);
    console.log(`${id} timeouts/throttle lines:`, JSON.stringify(timeouts));
  } catch (err) { console.log(`${id} logs: ${err.message.split('\n')[0]}`); }
}
