/**
 * Debounced sync — accumulates keys and flushes cache to server after 500ms.
 * Fire-and-forget, never blocks UI.
 */

import {
  putSyncData,
  getLearnerProfile, getLearnerProfileSummary,
  getPreferences,
  getCourseKB, getActivities, getActivityKBsForCourse,
  getDrafts, getCourseMessages, getUserCourseMarkdown,
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
  if (syncKey.startsWith('courseKB:')) return getCourseKB(syncKey.slice('courseKB:'.length));
  if (syncKey.startsWith('activities:')) return getActivities(syncKey.slice('activities:'.length));
  if (syncKey.startsWith('activityKBs:')) return getActivityKBsForCourse(syncKey.slice('activityKBs:'.length));
  if (syncKey.startsWith('drafts:')) return getDrafts(syncKey.slice('drafts:'.length));
  if (syncKey.startsWith('messages:')) return getCourseMessages(syncKey.slice('messages:'.length));
  if (syncKey.startsWith('courses:')) {
    const md = await getUserCourseMarkdown(syncKey.slice('courses:'.length));
    return md ? { courseId: syncKey.slice('courses:'.length), markdown: md } : null;
  }
  return null;
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
