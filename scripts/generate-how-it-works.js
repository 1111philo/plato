#!/usr/bin/env node
/**
 * Writes docs/HOW_IT_WORKS.md from plato's description of itself
 * (client/src/lib/transparency.js): every AI agent, what the coach is told,
 * every step a Trace records, the rules plato's code applies, the events it
 * logs, and the outside services it uses.
 *
 *   node scripts/generate-how-it-works.js          write the file
 *   node scripts/generate-how-it-works.js --check  exit 1 if it is out of date
 *
 * client/tests/how-it-works.test.js runs the check, so CI fails when the
 * registry changes and the doc wasn't regenerated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AGENTS, CONTEXT_FIELDS, PROMPT_PARTS, STEPS, RULES, THRESHOLDS, EVENTS, SERVICES, SOURCES } from '../client/src/lib/transparency.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'HOW_IT_WORKS.md');
const who = (source) => SOURCES[source].label;

export function render() {
  const out = [
    '# How plato works',
    '',
    '> Generated from `client/src/lib/transparency.js` by `scripts/generate-how-it-works.js`. Do not edit by hand: change the registry and regenerate.',
    '',
    'This is plato\u2019s plain-language description of itself. The Trace view, "Behind this response", the "How assessment works" page and the Privacy page read the same source, so they cannot disagree. For why things are built this way, see [ARCHITECTURE.md](ARCHITECTURE.md).',
    '',
    '## Who decides',
    '',
    'Every step is marked with who decided it:',
    '',
    ...Object.values(SOURCES).map((s) => `- **${s.label}.** ${s.means}`),
    '',
    '## The AI agents',
    '',
    'One AI model does all of this, given different instructions (`client/prompts/<id>.md`).',
    '',
  ];
  for (const [id, a] of Object.entries(AGENTS)) {
    out.push(`### ${a.label} (\`${id}\`)`, '', a.purpose, '', `- **Runs:** ${a.when}`, `- **Is given:** ${a.reads.join('; ')}.`, `- **Returns:** ${a.writes.join('; ')}.`, '');
  }
  out.push('## What an agent\u2019s instructions are made of', '', '| Part | Written by | What it is |', '|---|---|---|');
  for (const p of Object.values(PROMPT_PARTS)) out.push(`| ${p.label} | ${who(p.source)} | ${p.means} |`);
  out.push('', '## What the coach is told before every reply', '', '| Field | Written by | Where it comes from |', '|---|---|---|');
  for (const [id, f] of Object.entries(CONTEXT_FIELDS)) out.push(`| ${f.label} (\`${id}\`) | ${who(f.source)} | ${f.from} |`);
  out.push('', '## The rules plato\u2019s code applies', '', 'The model suggests; plato\u2019s code decides what is recorded. These apply whatever the model says.', '');
  for (const [id, text] of Object.entries(RULES)) out.push(`- **\`${id}\`** ${text}`);
  out.push('', '### The numbers behind them', '', '| Name | Meaning | Defined in |', '|---|---|---|');
  for (const [id, t] of Object.entries(THRESHOLDS)) out.push(`| \`${id}\` | ${t.means} | \`${t.where}\` |`);
  out.push('', '## What a Trace records', '', 'With Trace mode on, each turn of a conversation is recorded as these steps.', '', '| Step | Decided by | Meaning |', '|---|---|---|');
  for (const [id, s] of Object.entries(STEPS)) out.push(`| ${s.title} (\`${id}\`) | ${who(s.source)} | ${s.means} |`);
  out.push('', '## What is reported to the server\u2019s logs', '', 'A code and the lesson\u2019s id. Never conversation text.', '');
  for (const [id, text] of Object.entries(EVENTS)) out.push(`- \`${id}\`: ${text}`);
  out.push('', '## Outside services, and what each is sent', '', 'plato has no analytics or tracking.', '', '| Service | Role | Used | What it is sent |', '|---|---|---|---|');
  for (const s of Object.values(SERVICES)) out.push(`| ${s.name} | ${s.role} | ${s.when} | ${s.sent}${s.note ? ` ${s.note}` : ''} |`);
  out.push('');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = render();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (current !== next) {
      console.error('docs/HOW_IT_WORKS.md is out of date. Run: node scripts/generate-how-it-works.js');
      process.exit(1);
    }
    console.log('docs/HOW_IT_WORKS.md is up to date.');
  } else {
    writeFileSync(OUT, next);
    console.log(`Wrote ${OUT}`);
  }
}
