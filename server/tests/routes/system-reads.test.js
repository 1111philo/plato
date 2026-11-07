/**
 * How many `_system` reads one learner page load costs (#451 scale review,
 * B1/B2): the classroom's requests, done twice, with the cache off and on.
 * Real SQLite backend; reads are counted at the backend.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { Hono } from 'hono';

const DB_PATH = './data/test-system-reads.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db.js');
const { invalidateSystemCache } = await import('../../src/lib/system-cache.js');
const { default: content } = await import('../../src/routes/content.js');
const { default: me } = await import('../../src/routes/me.js');
const { default: app } = await import('../../src/routes/app.js');
const { signAccessToken } = await import('../../src/lib/jwt.js');
const { _resetTimeStatsRefreshThrottle } = await import('../../src/lib/lesson-time-stats.js');
const { whenJobsIdle } = await import('../../src/lib/jobs.js');

after(() => { for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f); });

const reads = { all: 0, one: 0, prefix: 0, users: 0 };
for (const [m, k] of [['getAllSyncData', 'all'], ['getSyncData', 'one'], ['getSyncDataByPrefix', 'prefix']]) {
  const orig = db[m].bind(db);
  db[m] = async (userId, ...rest) => { if (userId === '_system') reads[k]++; return orig(userId, ...rest); };
}
const origList = db.listAllUsers.bind(db);
db.listAllUsers = async () => { reads.users++; return origList(); };

async function pageLoad(token) {
  const s = new Hono();
  for (const r of [content, me, app]) s.route('/', r);
  const h = { headers: { Authorization: 'Bearer ' + token } };
  // What the classroom asks for on load (LessonsList, AppShell, bell, gate, branding).
  for (const path of ['/v1/branding', '/v1/me', '/v1/me/fields', '/v1/lessons', '/v1/lessons/time-stats', '/v1/me/messages', '/v1/groups']) {
    const res = await s.request(path, h);
    assert.ok(res.status < 500, `${path} ${res.status}`);
  }
}
const total = () => reads.all + reads.one + reads.prefix;
const reset = () => { for (const k of Object.keys(reads)) reads[k] = 0; };

describe('_system reads per learner page load', () => {
  let token;
  before(async () => {
    await db.createUser({ userId: 'usr_ada', email: 'ada@example.com', passwordHash: 'x', name: 'Ada', role: 'learner' });
    await db.createSyncData('_system', 'settings', { classroomName: 'C', userGroups: ['A'], userFields: [] });
    for (let i = 0; i < 5; i++) await db.createSyncData('_system', `lesson:l${i}`, { name: `L${i}`, markdown: `# L${i}\n\n## Learning Objectives\n\n- Can a\n- Can b`, status: 'public' });
    for (let i = 0; i < 14; i++) await db.createSyncData('_system', `prompt:p${i}`, { content: 'x'.repeat(2000) });
    await db.createSyncData('_system', 'stats:timeStats', { computedAt: new Date().toISOString(), byLesson: {} });
    token = await signAccessToken('usr_ada', 'learner');
  });

  it('with the cache off, every load reads again; with it on, a second load reads nothing, and no users are scanned', async () => {
    delete process.env.PLATO_SYSTEM_CACHE;
    process.env.PLATO_SYSTEM_CACHE = 'off';
    _resetTimeStatsRefreshThrottle();
    reset();
    await pageLoad(token);
    await pageLoad(token);
    const off = { ...reads, total: total() };

    process.env.PLATO_SYSTEM_CACHE = 'on';
    invalidateSystemCache();
    reset();
    await pageLoad(token);
    const onFirst = total();
    await pageLoad(token);
    const onSecond = total() - onFirst;
    await whenJobsIdle();
    delete process.env.PLATO_SYSTEM_CACHE;
    console.log(`_system reads, 2 loads: cache off ${off.total} (full-partition ${off.all}); cache on: first ${onFirst}, second ${onSecond}`);
    assert.equal(onSecond, 0);
    assert.ok(onFirst < off.total / 2);
    assert.equal(off.users + reads.users, 0, 'no learner request scanned users');
  });
});
