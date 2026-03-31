/**
 * Debounced sync — accumulates keys and pushes to server after 500ms.
 * Fire-and-forget, never blocks UI.
 */

import * as sync from '../../js/sync.js';

const _pendingSyncKeys = new Set();
let _syncTimer = null;

export function syncInBackground(...syncKeys) {
  for (const key of syncKeys) _pendingSyncKeys.add(key);
  if (_syncTimer) return;
  _syncTimer = setTimeout(() => {
    const keys = [..._pendingSyncKeys];
    _pendingSyncKeys.clear();
    _syncTimer = null;
    Promise.resolve().then(async () => {
      for (const key of keys) {
        try { await sync.save(key); } catch { /* silent */ }
      }
    });
  }, 500);
}
