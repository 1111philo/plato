#!/usr/bin/env node
/**
 * Export every lesson's markdown for a reviewed rewrite (#261). Read-only.
 *
 * Usage (from server/):
 *   AWS_PROFILE=dase AWS_REGION=us-east-2 node scripts/export-lessons.js ./lessons-export
 *   DB_BACKEND=sqlite SQLITE_PATH=./data/plato-dev.db node scripts/export-lessons.js ./out
 *
 * Writes `<lessonId>.md` per lesson plus `manifest.json` (see
 * src/lib/lesson-rewrite.js). Edit the .md files, then run
 * scripts/apply-lessons.js on the same directory.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('Usage: node scripts/export-lessons.js <output-dir>'); process.exit(2); }
const db = (await import('../src/lib/db.js')).default;
const { manifestEntry } = await import('../src/lib/lesson-rewrite.js');

const items = (await db.getAllSyncData('_system')).filter((i) => i.dataKey.startsWith('lesson:') && i.data?.markdown);
mkdirSync(out, { recursive: true });
const lessons = [];
for (const i of items.sort((a, b) => a.dataKey.localeCompare(b.dataKey))) {
  const lessonId = i.dataKey.slice('lesson:'.length);
  writeFileSync(join(out, `${lessonId}.md`), i.data.markdown);
  lessons.push(manifestEntry(lessonId, i.data));
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), lessons }, null, 2) + '\n');
console.log(`Exported ${lessons.length} lesson(s) to ${resolve(out)} (read-only; nothing in plato changed).`);
for (const l of lessons) console.log(`  ${l.lessonId}  ${l.status || ''}  ${l.name}`);
