/**
 * Migration runner (src/lib/migrations.js): locking, idempotence, retry on
 * failure, dry-run, and the bounded startup wrapper.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, runMigrationsBounded } from '../../src/lib/migrations.js';

// In-memory stand-in with the same version semantics as the real backends.
function fakeDb() {
  const rows = new Map();
  const conflict = () => Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' });
  return {
    rows,
    async getSyncData(u, k) { return rows.get(`${u}:${k}`) || null; },
    async putSyncData(u, k, data, expectedVersion) {
      const cur = rows.get(`${u}:${k}`);
      if (expectedVersion && cur && cur.version !== expectedVersion) throw conflict();
      const version = (expectedVersion || 0) + 1;
      rows.set(`${u}:${k}`, { data: structuredClone(data), version });
      return { version };
    },
    async createSyncData(u, k, data) {
      if (rows.has(`${u}:${k}`)) throw conflict();
      rows.set(`${u}:${k}`, { data: structuredClone(data), version: 1 });
      return { version: 1 };
    },
  };
}

const counter = (id, result = { scanned: 1, updated: 1 }) => {
  const m = { id, description: id, calls: 0, async run() { m.calls++; return result; } };
  return m;
};

describe('runMigrations', () => {
  it('runs pending migrations in order and records them', async () => {
    const db = fakeDb();
    const order = [];
    const a = { id: 'a', description: 'a', run: async () => { order.push('a'); return {}; } };
    const b = { id: 'b', description: 'b', run: async () => { order.push('b'); return {}; } };
    const out = await runMigrations({ db, migrations: [a, b] });
    assert.deepEqual(order, ['a', 'b']);
    assert.deepEqual(out.ran.map((r) => r.id), ['a', 'b']);
    const state = (await db.getSyncData('_system', 'migrations')).data;
    assert.ok(state.applied.a && state.applied.b);
    assert.equal(state.lock, null);
  });

  it('is idempotent: applied migrations never run again', async () => {
    const db = fakeDb();
    const m = counter('once');
    await runMigrations({ db, migrations: [m] });
    const second = await runMigrations({ db, migrations: [m] });
    assert.equal(m.calls, 1);
    assert.equal(second.skipped, 'none_pending');
  });

  it('a migration with errors is not recorded, so the next cold start retries it', async () => {
    const db = fakeDb();
    let fail = true;
    const flaky = { id: 'flaky', description: 'flaky', run: async () => (fail ? { errors: 1 } : { updated: 1 }) };
    await runMigrations({ db, migrations: [flaky] });
    assert.equal((await db.getSyncData('_system', 'migrations')).data.applied.flaky, undefined);
    fail = false;
    const retry = await runMigrations({ db, migrations: [flaky] });
    assert.equal(retry.ran[0].result.errors, 0);
    assert.ok((await db.getSyncData('_system', 'migrations')).data.applied.flaky);
  });

  it('a throwing migration counts as an error and does not block later ones', async () => {
    const db = fakeDb();
    const boom = { id: 'boom', description: 'boom', run: async () => { throw new Error('kaboom'); } };
    const next = counter('next');
    const out = await runMigrations({ db, migrations: [boom, next] });
    assert.equal(out.ran[0].result.errors, 1);
    assert.equal(out.ran[0].result.fatal, 'kaboom');
    assert.equal(next.calls, 1);
  });

  it('skips while another container holds a live lock, and takes over an expired one', async () => {
    const db = fakeDb();
    await db.createSyncData('_system', 'migrations', { applied: {}, lock: { owner: 'other', until: 2_000 } });
    const m = counter('m');
    assert.equal((await runMigrations({ db, migrations: [m], now: () => 1_000 })).skipped, 'locked');
    assert.equal(m.calls, 0);
    await runMigrations({ db, migrations: [m], now: () => 3_000 });
    assert.equal(m.calls, 1);
  });

  it('only one of two concurrent runners wins the lock', async () => {
    const db = fakeDb();
    const m = counter('race');
    const [x, y] = await Promise.all([
      runMigrations({ db, migrations: [m], owner: 'x' }),
      runMigrations({ db, migrations: [m], owner: 'y' }),
    ]);
    assert.equal(m.calls, 1);
    assert.ok([x.skipped, y.skipped].some((s) => s === 'lost_race' || s === 'locked'));
  });

  it('dry run reports but writes nothing (not even the lock)', async () => {
    const db = fakeDb();
    const seen = [];
    const m = { id: 'dry', description: 'dry', run: async ({ dryRun }) => { seen.push(dryRun); return { updated: 3 }; } };
    const out = await runMigrations({ db, migrations: [m], dryRun: true });
    assert.deepEqual(seen, [true]);
    assert.equal(out.ran[0].result.updated, 3);
    assert.equal(db.rows.size, 0);
  });
});

describe('runMigrationsBounded', () => {
  it('returns after the budget even if a migration hangs', async () => {
    const db = fakeDb();
    const hang = { id: 'hang', description: 'hang', run: () => new Promise(() => {}) };
    const started = Date.now();
    const outcome = await runMigrationsBounded({ db, migrations: [hang], budgetMs: 50 });
    assert.equal(outcome, 'timeout');
    assert.ok(Date.now() - started < 1000);
  });

  it('never throws', async () => {
    const broken = { getSyncData: async () => { throw new Error('db down'); } };
    assert.equal(await runMigrationsBounded({ db: broken, migrations: [counter('x')] }), null);
  });
});
