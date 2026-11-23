#!/usr/bin/env node
/**
 * Proves an edit changed only comments and whitespace: for each JS/JSX file
 * that differs from a git ref, parses both versions and compares their
 * syntax trees with positions and comments removed.
 *
 *   node scripts/code-unchanged.js origin/playground
 *
 * Exits 1 and names the files whose code changed. Used for comment-only
 * cleanups, where a diff of thousands of lines must not hide a code change.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../client/package.json'));
const acorn = require('acorn');
const jsx = require('acorn-jsx');
const Parser = acorn.Parser.extend(jsx());

const ref = process.argv[2] || 'origin/playground';
const changed = execFileSync('git', ['diff', '--name-only', ref, '--', '*.js', '*.jsx', '*.mjs'], { encoding: 'utf8' }).split('\n').filter(Boolean);

const DROP = new Set(['start', 'end', 'loc', 'range', 'raw']);
function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    // JSX text is whitespace-sensitive only in what renders; collapse it.
    if (node.type === 'JSXText' && k === 'value') { out[k] = v.replace(/\s+/g, ' ').trim(); continue; }
    if (k === 'value' && typeof v === 'bigint') { out[k] = String(v); continue; }
    out[k] = strip(v);
  }
  // Drop JSX text nodes that are only whitespace (line breaks moved by an edit).
  if (Array.isArray(out.children)) out.children = out.children.filter((c) => !(c?.type === 'JSXText' && c.value === ''));
  return out;
}
const parse = (src) => strip(Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }));

let bad = 0;
for (const file of changed) {
  let before = null;
  try { before = execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { console.log(`new   ${file}`); continue; }
  let after;
  try { after = execFileSync('cat', [file], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { console.log(`gone  ${file}`); bad++; continue; }
  try {
    if (JSON.stringify(parse(before)) !== JSON.stringify(parse(after))) { console.log(`CODE  ${file}`); bad++; }
  } catch (e) { console.log(`PARSE ${file}: ${e.message}`); bad++; }
}
console.log(`${changed.length} changed files checked; ${bad} with code changes`);
process.exit(bad ? 1 : 0);
