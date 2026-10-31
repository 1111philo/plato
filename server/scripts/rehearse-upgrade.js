#!/usr/bin/env node
/**
 * Rehearse the launch upgrade on restored copies of an install's tables.
 * Self-hosted installs can run it too. It:
 *   1. snapshots every record (users + sync-data),
 *   2. runs the data migrations and the bundled-lesson install for real (--apply),
 *   3. diffs before/after: nothing removed, changes only where a migration says
 *      it may change, and learner work (messages, screenshots, lessonKB,
 *      courseProgress, custom lessons) byte-for-byte untouched,
 *   4. serves the migrated tables with Beta-RC-232's own route handlers
 *      (extracted from the git tag) to prove a rollback still works.
 *
 * Never point it at live tables. Restore first, e.g.
 *   aws dynamodb restore-table-to-point-in-time --source-table-name plato-users \
 *     --target-table-name plato-rehearsal-users --use-latest-restorable-time
 * (and the same for invites, refresh-tokens, sync-data, audit-log), then:
 *
 *   AWS_PROFILE=… AWS_REGION=… node scripts/rehearse-upgrade.js plato-rehearsal
 *
 * Prints a Markdown report. Exit code 1 on any failed check.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const prefix = process.argv[2];
if (!prefix || !/rehearsal/.test(prefix)) {
  console.error('Usage: node scripts/rehearse-upgrade.js <table-prefix containing "rehearsal">'); process.exit(2);
}
for (const [env, t] of [['USERS_TABLE', 'users'], ['INVITES_TABLE', 'invites'], ['REFRESH_TOKENS_TABLE', 'refresh-tokens'], ['SYNC_DATA_TABLE', 'sync-data'], ['AUDIT_LOG_TABLE', 'audit-log']]) {
  process.env[env] = `${prefix}-${t}`;
}
process.env.DB_BACKEND = 'dynamodb';
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = (await import('../src/lib/db.js')).default;
const { runMigrations } = await import('../src/lib/migrations.js');
const { ensureBundledLessons } = await import('../src/lib/bundled-lessons.js');

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
async function snapshot() {
  const out = new Map();
  const users = await db.listAllUsers();
  for (const u of users) out.set(`user:${u.userId}`, sha(u));
  for (const owner of ['_system', ...users.map((u) => u.userId)]) {
    for (const i of await db.getAllSyncData(owner)) out.set(`sync:${owner}:${i.dataKey}`, sha({ d: i.data, v: i.version }));
  }
  return { out, users };
}

const ALLOWED_ADDED = [/^sync:_system:migrations$/, /^sync:_system:program:prog-default$/, /^sync:_system:lesson:getting-started$/, /^sync:_system:bundled:getting-started$/];
const ALLOWED_CHANGED = [/^user:/, /^sync:_system:course:/];
const LEARNER_WORK = /^sync:usr_[^:]+:(messages|screenshot|lessonKB|courseProgress|lessons):/;

const lines = [`# Upgrade rehearsal on \`${prefix}-*\``, '', `Run ${new Date().toISOString()}`, ''];
let failed = false;
const check = (ok, text) => { lines.push(`- ${ok ? '✅' : '❌'} ${text}`); if (!ok) failed = true; };

const before = await snapshot();
const byPrefix = (m) => {
  const c = {};
  for (const k of m.keys()) { const p = k.startsWith('user:') ? 'users' : k.split(':').slice(2, 3)[0].split(/[:]/)[0]; c[p] = (c[p] || 0) + 1; }
  return c;
};
lines.push('## Before', '', '```', JSON.stringify(byPrefix(before.out), null, 1), '```', '');

const outcome = await runMigrations();
const bundled = await ensureBundledLessons({ db });
lines.push('## Migrations', '');
for (const { id, result } of outcome.ran) {
  lines.push(`- \`${id}\`: scanned ${result.scanned}, updated ${result.updated}, skipped ${result.skipped}, errors ${result.errors}${(result.notes || []).map((n) => `; ${n}`).join('')}`);
  check(result.errors === 0, `${id} had no errors`);
}
if (outcome.skipped) lines.push(`- skipped: ${outcome.skipped}`);
lines.push(`- bundled lessons: installed ${bundled.installed.join(', ') || 'none'}`, '');

const after = await snapshot();
const added = [...after.out.keys()].filter((k) => !before.out.has(k));
const removed = [...before.out.keys()].filter((k) => !after.out.has(k));
const changed = [...before.out.keys()].filter((k) => after.out.has(k) && after.out.get(k) !== before.out.get(k));
lines.push('## Diff', '', `added ${added.length}, removed ${removed.length}, changed ${changed.length}`, '');
check(removed.length === 0, 'no record removed');
const badAdded = added.filter((k) => !ALLOWED_ADDED.some((r) => r.test(k)));
check(badAdded.length === 0, `only expected records added${badAdded.length ? `: ${badAdded.slice(0, 5).join(', ')}` : ''}`);
const badChanged = changed.filter((k) => !ALLOWED_CHANGED.some((r) => r.test(k)));
check(badChanged.length === 0, `only users and units changed${badChanged.length ? `: ${badChanged.slice(0, 5).join(', ')}` : ''}`);
const work = [...before.out.keys()].filter((k) => LEARNER_WORK.test(k));
check(work.every((k) => after.out.get(k) === before.out.get(k)), `learner work untouched (${work.length} records: conversations, screenshots, progress, unit notes, custom lessons)`);
const gs = (await db.getSyncData('_system', 'lesson:getting-started'))?.data;
check(!gs || gs.status === 'private', 'Getting Started arrived private');
const again = await runMigrations();
check(again.ran.length === 0, 'a second run does nothing');

// Rollback: Beta-RC-232's handlers against the migrated tables.
const tag = 'Beta-RC-232';
// Inside server/ so the extracted code resolves server/node_modules (ESM ignores NODE_PATH).
const tmp = mkdtempSync(join(SERVER, '.rc232-rehearsal-'));
try {
  const archive = execFileSync('git', ['archive', tag, 'server/src'], { cwd: join(SERVER, '..'), maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '--strip-components=1', '-C', tmp], { input: archive });
  const admin = after.users.find((u) => u.role === 'admin');
  const learner = after.users.filter((u) => u.role !== 'admin').sort((a, b) => (b.lessonsCompleted || 0) - (a.lessonsCompleted || 0))[0];
  const child = join(tmp, 'check.mjs');
  writeFileSync(child, `
    import { Hono } from 'hono';
    const load = async (p) => (await import(new URL(p, import.meta.url))).default;
    const { signAccessToken } = await import(new URL('./src/lib/jwt.js', import.meta.url));
    const app = new Hono();
    for (const r of ['auth', 'me', 'admin', 'sync', 'content']) app.route('/', await load('./src/routes/' + r + '.js'));
    const a = await signAccessToken(${JSON.stringify(admin.userId)}, 'admin');
    const l = await signAccessToken(${JSON.stringify(learner.userId)}, 'user');
    const out = {};
    for (const [label, tok, path] of [['admin users', a, '/v1/admin/users'], ['admin lessons', a, '/v1/admin/lessons'], ['admin courses', a, '/v1/admin/courses'], ['learner me', l, '/v1/me'], ['learner lessons', l, '/v1/lessons'], ['learner sync', l, '/v1/sync']]) {
      const res = await app.request(path, { headers: { Authorization: 'Bearer ' + tok } });
      const body = await res.json().catch(() => null);
      out[label] = { status: res.status, count: Array.isArray(body) ? body.length : Array.isArray(body?.courses) ? body.courses.length : Array.isArray(body?.items) ? body.items.length : null, role: body?.role };
    }
    console.log(JSON.stringify(out));
  `);
  const r = spawnSync(process.execPath, [child], { cwd: SERVER, env: process.env, encoding: 'utf8' });
  const res = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
  lines.push('', `## Rollback check (${tag} handlers)`, '');
  for (const [label, v] of Object.entries(res)) check(v.status === 200, `${label}: ${v.status}${v.count != null ? `, ${v.count} item(s)` : ''}${v.role ? `, role ${v.role}` : ''}`);
  if (!Object.keys(res).length) check(false, `RC-232 check didn't run: ${r.stderr.slice(0, 300)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(lines.join('\n'));
process.exit(failed ? 1 : 0);
