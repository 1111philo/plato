#!/usr/bin/env node
/**
 * Per-endpoint latency and status table from a k6 CSV output.
 *
 *   k6 run --out csv=scripts/loadtest/.out/run.csv … && node scripts/loadtest/analyze.mjs scripts/loadtest/.out/run.csv
 *
 * Prints a markdown table: requests, p50/p95/p99/max of http_req_duration
 * (and of http_req_waiting, time to first byte, which for the AI stream is
 * time to first token: the server holds headers until Bedrock's first event),
 * and the status codes seen.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.argv[2];
if (!file) { console.error('usage: analyze.mjs <k6.csv>'); process.exit(1); }

const rl = createInterface({ input: createReadStream(file) });
let cols = null;
const dur = new Map(); const ttfb = new Map(); const statuses = new Map();
let first = Infinity; let last = 0;
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

for await (const line of rl) {
  const f = line.split(',');
  if (!cols) { cols = Object.fromEntries(f.map((c, i) => [c, i])); continue; }
  const metric = f[cols.metric_name];
  if (metric !== 'http_req_duration' && metric !== 'http_req_waiting') continue;
  const name = f[cols.name] || f[cols.url];
  const v = Number(f[cols.metric_value]);
  const t = Number(f[cols.timestamp]);
  first = Math.min(first, t); last = Math.max(last, t);
  if (metric === 'http_req_duration') {
    push(dur, name, v);
    const s = f[cols.status];
    if (!statuses.has(name)) statuses.set(name, new Map());
    statuses.get(name).set(s, (statuses.get(name).get(s) || 0) + 1);
  } else push(ttfb, name, v);
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const stats = (a) => { a.sort((x, y) => x - y); return [pct(a, 50), pct(a, 95), pct(a, 99), a[a.length - 1]].map(ms).join(' | '); };

const showTtfb = process.argv.includes('--ttfb');
console.log(`Window: ${new Date(first * 1000).toISOString()} → ${new Date(last * 1000).toISOString()}\n`);
console.log(`| Endpoint | Requests | p50 | p95 | p99 | max |${showTtfb ? ' TTFB p50 | p95 | p99 | max |' : ''} Status |`);
console.log(`|---|---|---|---|---|---|${showTtfb ? '---|---|---|---|' : ''}---|`);
let total = 0; let bad = 0;
for (const [name, a] of [...dur].sort((x, y) => y[1].length - x[1].length)) {
  const st = [...statuses.get(name)].sort().map(([s, n]) => { total += n; if (!/^2/.test(s)) bad += n; return `${s}: ${n}`; }).join(', ');
  console.log(`| ${name} | ${a.length} | ${stats(a)} |${showTtfb ? ` ${stats(ttfb.get(name) || [0])} |` : ''} ${st} |`);
}
console.log(`\nTotal requests ${total}, non-2xx ${bad} (${((bad / total) * 100).toFixed(2)}%)`);
