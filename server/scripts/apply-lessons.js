#!/usr/bin/env node
/**
 * Apply reviewed lesson rewrites (#261) from an export directory. Dry run
 * unless --apply. Only lessons whose file changed are touched. Each is
 * refused if it changed in plato since the export, fails the lesson checks,
 * or changes its number of objectives (src/lib/lesson-rewrite.js). Every
 * applied lesson is a version-checked write plus a `lesson_rewrite_applied`
 * audit entry with the before/after hashes. Status, unit, sharing, and
 * learner progress are untouched.
 *
 * Usage (from server/):
 *   AWS_PROFILE=dase AWS_REGION=us-east-2 node scripts/apply-lessons.js ./lessons-export            # dry run
 *   AWS_PROFILE=dase AWS_REGION=us-east-2 node scripts/apply-lessons.js ./lessons-export --apply
 *   ... --only=les-f1,les-f2   # limit to some lessons
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const apply = process.argv.includes('--apply');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
if (!dir || !existsSync(join(dir, 'manifest.json'))) { console.error('Usage: node scripts/apply-lessons.js <export-dir> [--apply] [--only=id,id]'); process.exit(2); }

const db = (await import('../src/lib/db.js')).default;
const { planLesson, rewrittenRecord, hashOf } = await import('../src/lib/lesson-rewrite.js');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

console.log(`Mode: ${apply ? 'APPLY' : 'dry run (no writes)'}  |  export from ${manifest.exportedAt}`);
let failed = 0;
for (const entry of manifest.lessons.filter((l) => !only.length || only.includes(l.lessonId))) {
  const file = join(dir, `${entry.lessonId}.md`);
  const edited = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const item = await db.getSyncData('_system', `lesson:${entry.lessonId}`);
  const plan = planLesson(entry, item?.data || null, edited);
  if (plan.action === 'unchanged') continue;
  console.log(`  ${plan.action.padEnd(9)} ${entry.lessonId}  ${entry.name}${plan.reason ? `  (${plan.reason})` : ''}`);
  if (plan.action !== 'update') { if (plan.action !== 'missing') failed++; continue; }
  if (!apply) continue;
  try {
    await db.putSyncData('_system', `lesson:${entry.lessonId}`, rewrittenRecord(item.data, edited), item.version);
    await db.createAuditLog({
      action: 'lesson_rewrite_applied', userId: 'lesson-rewrite', performedBy: 'lesson-rewrite',
      details: { lessonId: entry.lessonId, from: entry.hash, to: hashOf(edited) },
    });
  } catch (err) {
    failed++;
    console.log(`    write failed: ${err.name === 'ConditionalCheckFailedException' ? 'changed during the run; export again' : err.message}`);
  }
}
process.exit(failed ? 1 : 0);
