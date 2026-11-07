// Coming back to the tab re-syncs (progress from another device, new
// lessons), but at most every REFOCUS_SYNC_MS: hundreds of learners
// alt-tabbing back after a break each used to reload everything at once
// (#451 scale review, B1). Used by AppContext.

export const REFOCUS_SYNC_MS = 5 * 60 * 1000;
let lastFullSync = 0;

/** Record a full load (the initial one, or a refocus re-sync). */
export function markFullSync(now = Date.now()) { lastFullSync = now; }

/** Whether a refocus at `now` should re-sync; if so, it's recorded. */
export function shouldResyncOnRefocus(now = Date.now()) {
  if (now - lastFullSync < REFOCUS_SYNC_MS) return false;
  lastFullSync = now;
  return true;
}

/** For tests. */
export function _resetRefocusSync() { lastFullSync = 0; }
