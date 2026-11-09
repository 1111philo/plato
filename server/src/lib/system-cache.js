/**
 * In-container cache for `_system` reads on hot, read-only paths (#451 scale
 * review, B1). Every learner page load and tab refocus used to read the whole
 * `_system` partition (lessons, prompts, settings, …) straight from DynamoDB;
 * with hundreds of learners refocusing together that passes the per-partition
 * read limit. Here a container keeps what it read for `SYSTEM_CACHE_TTL_MS`.
 *
 * - **Freshness.** Any `_system` write made through `db` in this container
 *   clears the cache at once (db.js wraps the write methods). Other
 *   containers can serve up to one TTL of staleness after an admin edit;
 *   that's the trade, and it's documented in ARCHITECTURE ("System data
 *   cache").
 * - **Read-only.** Callers get shared objects: never mutate what this
 *   returns. Paths that read-modify-write (admin saves, migrations, seeding,
 *   version-conditioned puts) keep reading `db` directly, never this.
 * - **Concurrent misses share one read** (the in-flight promise is cached).
 * - **On by default on Lambda and the dev servers**; off elsewhere (unit
 *   tests swap `db` methods per test, which a cache would hide). Turn on with
 *   `PLATO_SYSTEM_CACHE=on`, or pass `ttlMs` to the helpers in tests.
 */
import defaultDb, { onSystemWrite } from './db.js';

export const SYSTEM_CACHE_TTL_MS = 30_000;

function defaultTtl() {
  if (process.env.PLATO_SYSTEM_CACHE === 'off') return 0;
  if (process.env.PLATO_SYSTEM_CACHE === 'on' || process.env.AWS_LAMBDA_FUNCTION_NAME) return SYSTEM_CACHE_TTL_MS;
  return 0;
}

const entries = new Map(); // cache key → { at, value (or a promise of it) }
let generation = 0;
const stats = { hits: 0, misses: 0 };

/** Forget everything. Called on every `_system` write through db.js. */
export function invalidateSystemCache() {
  entries.clear();
  generation++;
}

onSystemWrite(invalidateSystemCache);

/** For tests: hit/miss counts since the last reset. */
export function systemCacheStats() { return { ...stats }; }
export function resetSystemCacheStats() { stats.hits = 0; stats.misses = 0; }

async function cached(key, load, { ttlMs = defaultTtl(), now = Date.now } = {}) {
  if (!ttlMs) return load();
  const hit = entries.get(key);
  if (hit && now() - hit.at < ttlMs) { stats.hits++; return hit.value; }
  stats.misses++;
  const gen = generation;
  const at = now();
  const pending = load();
  entries.set(key, { at, value: pending });
  try {
    const value = await pending;
    // A write during the read invalidated it; don't store the older result.
    if (gen === generation) entries.set(key, { at, value });
    return value;
  } catch (err) {
    if (entries.get(key)?.value === pending) entries.delete(key);
    throw err;
  }
}

/** Every `_system` item (`db.getAllSyncData('_system')`), cached. */
export function systemItems({ db = defaultDb, ...opts } = {}) {
  return cached('all', () => db.getAllSyncData('_system'), opts);
}

/** One `_system` item (`db.getSyncData('_system', key)`), cached; null when missing. */
export function systemItem(dataKey, { db = defaultDb, ...opts } = {}) {
  return cached(`key:${dataKey}`, async () => (await db.getSyncData('_system', dataKey)) ?? null, opts);
}

/** `_system` items whose key starts with `prefix`, cached. */
export function systemItemsByPrefix(prefix, { db = defaultDb, ...opts } = {}) {
  return cached(`prefix:${prefix}`, () => db.getSyncDataByPrefix('_system', prefix), opts);
}
