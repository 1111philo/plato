/**
 * Debounced sync — accumulates keys and flushes cache to server after 500ms.
 * Fire-and-forget, never blocks UI.
 *
 * The save* helpers in storage.js already PUT directly and return whether the
 * write landed. Re-sending a record that just saved doubled every write
 * (#451 scale review H2), so callers use `syncIfUnsaved`: a background retry
 * only when the direct write didn't reach the server.
 */

import {
  putSyncData,
  getLearnerProfile, getLearnerProfileSummary,
  getPreferences,
  getLessonKB, getActivities, getActivityKBsForLesson,
  getDrafts, getLessonMessages, getUserLessonMarkdown,
} from '../../js/storage.js';

const _pendingSyncKeys = new Set();
let _syncTimer = null;

async function getCacheData(syncKey) {
  if (syncKey === 'profile') return getLearnerProfile();
  if (syncKey === 'profileSummary') {
    const s = await getLearnerProfileSummary();
    return s || null;
  }
  if (syncKey === 'preferences') return getPreferences();
  if (syncKey.startsWith('lessonKB:')) return getLessonKB(syncKey.slice('lessonKB:'.length));
  if (syncKey.startsWith('activities:')) return getActivities(syncKey.slice('activities:'.length));
  if (syncKey.startsWith('activityKBs:')) return getActivityKBsForLesson(syncKey.slice('activityKBs:'.length));
  if (syncKey.startsWith('drafts:')) return getDrafts(syncKey.slice('drafts:'.length));
  if (syncKey.startsWith('messages:')) return getLessonMessages(syncKey.slice('messages:'.length));
  if (syncKey.startsWith('lessons:')) {
    const md = await getUserLessonMarkdown(syncKey.slice('lessons:'.length));
    return md ? { lessonId: syncKey.slice('lessons:'.length), markdown: md } : null;
  }
  return null;
}

/** Retry `syncKeys` in the background only if the direct save didn't land. */
export function syncIfUnsaved(saved, ...syncKeys) {
  if (saved !== true) syncInBackground(...syncKeys);
}

export function syncInBackground(...syncKeys) {
  for (const key of syncKeys) _pendingSyncKeys.add(key);
  if (_syncTimer) return;
  _syncTimer = setTimeout(() => {
    const keys = [..._pendingSyncKeys];
    _pendingSyncKeys.clear();
    _syncTimer = null;
    Promise.resolve().then(async () => {
      for (const key of keys) {
        try {
          const data = await getCacheData(key);
          if (data !== null && data !== undefined) {
            await putSyncData(key, data);
          }
        } catch { /* silent */ }
      }
    });
  }, 500);
}
