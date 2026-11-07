/**
 * Database router — selects DynamoDB or SQLite backend based on DB_BACKEND env var.
 *
 * It also reports every `_system` write (put, create, delete) to listeners
 * registered with `onSystemWrite`, so the in-container `_system` read cache
 * (lib/system-cache.js) is cleared the moment this container changes system
 * data. Tests that replace these methods bypass it; the cache is off in tests.
 */

const backend = process.env.DB_BACKEND || 'dynamodb';

let db;
if (backend === 'sqlite') {
  const mod = await import('./db-sqlite.js');
  db = mod.default;
} else {
  const mod = await import('./db-dynamodb.js');
  db = mod.default;
}

const systemWriteListeners = new Set();

/** Call `fn()` after every `_system` write made through this module. */
export function onSystemWrite(fn) {
  systemWriteListeners.add(fn);
  return () => systemWriteListeners.delete(fn);
}

for (const method of ['putSyncData', 'createSyncData', 'deleteSyncData']) {
  const original = db[method].bind(db);
  db[method] = async (userId, ...rest) => {
    try {
      return await original(userId, ...rest);
    } finally {
      // Even a failed conditional write may mean the data moved under us.
      if (userId === '_system') for (const fn of systemWriteListeners) fn();
    }
  };
}

export default db;
