/**
 * The in-container `_system` read cache (#451 scale review, B1), and the
 * cheap existence checks used at cold start (B3). Runs on the real SQLite
 * backend so db.js's write wrapping is what invalidates.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

const DB_PATH = './data/test-system-cache.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db.js');
const {
  systemItems, systemItem, systemItemsByPrefix, invalidateSystemCache, systemCacheStats, resetSystemCacheStats,
} = await import('../../src/lib/system-cache.js');
const { isSetUp, markSetUp, _resetSetupState } = await import('../../src/lib/setup-state.js');

after(() => { for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f); });

const ON = { ttlMs: 30_000 };

describe('system cache', () => {
  beforeEach(async () => {
    for (const i of await db.getAllSyncData('_system')) await db.deleteSyncData('_system', i.dataKey);
    await db.createSyncData('_system', 'settings', { classroomName: 'One' });
    await db.createSyncData('_system', 'message:a', { subject: 'Hi' });
    invalidateSystemCache();
    resetSystemCacheStats();
  });

  it('serves repeat reads from memory within the TTL', async () => {
    const first = await systemItems(ON);
    const second = await systemItems(ON);
    assert.equal(second, first, 'same array');
    assert.deepEqual(systemCacheStats(), { hits: 1, misses: 1 });
    assert.equal((await systemItem('settings', ON)).data.classroomName, 'One');
    assert.equal((await systemItem('settings', ON)).data.classroomName, 'One');
    assert.equal((await systemItemsByPrefix('message:', ON)).length, 1);
    assert.equal(await systemItem('nope', ON), null, 'a missing key caches as null');
  });

  it('a _system write in this container clears it at once', async () => {
    assert.equal((await systemItem('settings', ON)).data.classroomName, 'One');
    const cur = await db.getSyncData('_system', 'settings');
    await db.putSyncData('_system', 'settings', { classroomName: 'Two' }, cur.version);
    assert.equal((await systemItem('settings', ON)).data.classroomName, 'Two');
    await db.createSyncData('_system', 'message:b', { subject: 'Again' });
    assert.equal((await systemItemsByPrefix('message:', ON)).length, 2);
    await db.deleteSyncData('_system', 'message:a');
    assert.equal((await systemItemsByPrefix('message:', ON)).length, 1);
  });

  it('a learner’s own writes don’t clear it', async () => {
    await systemItems(ON);
    await db.putSyncData('usr_1', 'lessonKB:x', { progress: 1 }, 0);
    await systemItems(ON);
    assert.deepEqual(systemCacheStats(), { hits: 1, misses: 1 });
  });

  it('expires after the TTL', async () => {
    let t = 1000;
    const now = () => t;
    await systemItems({ ttlMs: 50, now });
    t += 49;
    await systemItems({ ttlMs: 50, now });
    t += 2;
    await systemItems({ ttlMs: 50, now });
    assert.deepEqual(systemCacheStats(), { hits: 1, misses: 2 });
  });

  it('concurrent misses share one read', async () => {
    let reads = 0;
    const slow = { ...db, getAllSyncData: async (u) => { reads++; await new Promise((r) => setTimeout(r, 20)); return db.getAllSyncData(u); } };
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => systemItems({ ...ON, db: slow })));
    assert.equal(reads, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it('is off (straight to the db) unless turned on', async () => {
    await systemItems();
    await systemItems();
    assert.deepEqual(systemCacheStats(), { hits: 0, misses: 0 });
  });
});

describe('cold-start existence checks', () => {
  it('hasSyncDataWithPrefix and hasAnyUser read at most one item', async () => {
    assert.equal(await db.hasSyncDataWithPrefix('_system', 'message:'), true);
    assert.equal(await db.hasSyncDataWithPrefix('_system', 'lesson_'), false, 'LIKE wildcards are escaped');
    assert.equal(await db.hasSyncDataWithPrefix('_system', 'lesson:'), false);
  });

  it('setup state: asks until a user exists, then never again', async () => {
    _resetSetupState();
    let asks = 0;
    const fake = { hasAnyUser: async () => { asks++; return asks > 1; } };
    assert.equal(await isSetUp({ db: fake }), false);
    assert.equal(await isSetUp({ db: fake }), true);
    assert.equal(await isSetUp({ db: fake }), true);
    assert.equal(asks, 2);
    _resetSetupState();
    markSetUp();
    assert.equal(await isSetUp({ db: fake }), true);
    assert.equal(asks, 2);
  });
});
