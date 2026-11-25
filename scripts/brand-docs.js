#!/usr/bin/env node
/**
 * The product's name is **plato** in prose: bold and lowercase (Blake,
 * 2026-11-25). Rewrites markdown files so every prose mention is `**plato**`,
 * and leaves it alone where it isn't prose: fenced code, inline code, link
 * targets, URLs, HTML tags, and identifiers (`plato-users`, `/plato/`,
 * `plato.courses`, `1111philo/plato`). Idempotent.
 *
 *   node scripts/brand-docs.js [--check] file.md …
 *
 * `--check` exits 1 when a file would change (for a test or CI).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Same boundaries as client/src/lib/brand.js, plus not already **plato** / __plato__.
const WORD = /(?<![\p{L}\p{N}_/.\-@*#`])plato(?![\p{L}\p{N}_\-/@*`]|\.[\p{L}\p{N}])/gu;
// Pieces of a line that aren't prose: inline code, a link's target, a URL, an HTML tag.
const NOT_PROSE = /(`[^`]*`|\]\([^)]*\)|<https?:[^>]*>|https?:\/\/[^\s)>\]]+|<[^>]+>)/g;

export function brandMarkdown(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced || /^ {4,}\S/.test(line) && !/^\s*[-*\d]/.test(line)) return line;
    return line.split(NOT_PROSE).map((part, i) => (i % 2 ? part : part.replace(WORD, '**plato**'))).join('');
  }).join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  let changed = 0;
  for (const file of args.filter((a) => a !== '--check')) {
    const before = readFileSync(file, 'utf8');
    const after = brandMarkdown(before);
    if (after === before) continue;
    changed++;
    if (check) console.log(`${file}: the name isn't bold everywhere (run node scripts/brand-docs.js ${file})`);
    else writeFileSync(file, after);
  }
  if (check && changed) process.exit(1);
  if (!check) console.log(`${changed} file(s) updated`);
}
