/**
 * Platform utilities for 1111 Learn.
 * - resolveAssetURL  → returns relative paths for fetching static assets
 * - kvStorage        → IndexedDB-backed key-value storage for the SQLite database binary
 */

/**
 * Resolve a relative asset path to a fetchable URL.
 * Assets live alongside index.html in dist/.
 */
export function resolveAssetURL(relativePath) {
  return relativePath;
}

// -- Key-value storage (IndexedDB) --------------------------------------------

const IDB_NAME = '1111-kv';
const IDB_STORE = 'kv';

function _openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB-backed key-value storage for persisting the SQLite database binary.
 * Supports large blobs without the ~5MB localStorage limit.
 */
export const kvStorage = {
  async get(key) {
    const db = await _openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result != null ? { [key]: req.result } : {});
      req.onerror = () => resolve({});
    });
  },

  async set(data) {
    const key = Object.keys(data)[0];
    const value = data[key];
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async remove(key) {
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
