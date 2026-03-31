/**
 * Remote storage client for learn-service.
 * When logged in, data is saved to and loaded from the server.
 * Local storage is a read cache — populated from the server on startup.
 */

import { authenticatedFetch, isLoggedIn } from './auth.js';
import {
  getLearnerProfile, saveLearnerProfile,
  getLearnerProfileSummary, saveLearnerProfileSummary,
  getPreferences, savePreferences,
  getOnboardingComplete, saveOnboardingComplete,
  getCourseKB, saveCourseKB, deleteCourseKB,
  getActivities, saveActivity, deleteActivitiesForCourse,
  getActivityKBsForCourse, saveActivityKB, deleteActivityKBsForCourse,
  getDrafts, saveDraft, deleteDraftsForCourse,
  getCourseMessages, saveCourseMessages, clearCourseMessages,
  getScreenshot, saveScreenshot,
  deleteProfile, deleteProfileSummary, deletePreferences,
} from './storage.js';

const _versions = {};

// Keys the server currently accepts. New keys (activities, activityKBs, messages,
// courseKB, onboardingComplete) are stored locally and will sync once learn-service
// is updated. Until then, skip them to avoid 400 console noise.
const SERVER_KNOWN_PREFIXES = ['profile', 'profileSummary', 'preferences', 'summative', 'gap', 'journey', 'progress'];

function serverAcceptsKey(syncKey) {
  return SERVER_KNOWN_PREFIXES.some(p => syncKey === p || syncKey.startsWith(p + ':'));
}

/**
 * Save a key to the remote server.
 */
export async function save(syncKey) {
  if (!await isLoggedIn()) return;
  if (!serverAcceptsKey(syncKey)) return;

  const data = await getLocalData(syncKey);
  if (data === null || data === undefined) return;

  const version = _versions[syncKey] || 0;

  const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, version }),
  });

  if (res.ok) {
    _versions[syncKey] = (await res.json()).version;
  } else if (res.status === 400) {
    // Server doesn't recognize this sync key — skip silently
    return;
  } else if (res.status === 409) {
    const current = await fetchOne(syncKey);
    if (current) {
      const retry = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, version: current.version }),
      });
      if (retry.ok) {
        _versions[syncKey] = (await retry.json()).version;
      }
    }
  }
}

/**
 * Load all data from the server and write it into local storage.
 */
export async function loadAll() {
  if (!await isLoggedIn()) return;

  const res = await authenticatedFetch('/v1/sync');
  if (!res.ok) return;

  const items = await res.json();
  const serverKeys = new Set();

  for (const { dataKey, data, version } of items) {
    await saveLocalData(dataKey, data);
    _versions[dataKey] = version;
    serverKeys.add(dataKey);
  }

  // Remove local data the server doesn't have
  for (const key of ['profile', 'profileSummary']) {
    if (!serverKeys.has(key)) {
      const d = await getLocalData(key);
      if (d !== null && d !== undefined) await removeLocalData(key);
    }
  }
}

// -- Internal helpers ---------------------------------------------------------

async function fetchOne(syncKey) {
  const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`);
  if (!res.ok) return null;
  return res.json();
}

async function getLocalData(syncKey) {
  if (syncKey === 'profile') return getLearnerProfile();
  if (syncKey === 'profileSummary') return getLearnerProfileSummary().then(s => s || null);
  if (syncKey === 'preferences') return getPreferences();
  if (syncKey === 'onboardingComplete') return getOnboardingComplete();
  if (syncKey.startsWith('courseKB:')) return getCourseKB(syncKey.slice('courseKB:'.length));
  if (syncKey.startsWith('activities:')) return getActivities(syncKey.slice('activities:'.length));
  if (syncKey.startsWith('activityKBs:')) return getActivityKBsForCourse(syncKey.slice('activityKBs:'.length));
  if (syncKey.startsWith('drafts:')) {
    const drafts = await getDrafts(syncKey.slice('drafts:'.length));
    // getScreenshot is statically imported above
    return Promise.all(
      drafts.map(async (d) => {
        if (!d.screenshotKey) return d;
        const dataUrl = await getScreenshot(d.screenshotKey);
        return dataUrl ? { ...d, screenshotDataUrl: dataUrl } : d;
      })
    );
  }
  if (syncKey.startsWith('messages:')) return getCourseMessages(syncKey.slice('messages:'.length));
  return null;
}

async function saveLocalData(syncKey, data) {
  if (syncKey === 'profile') return saveLearnerProfile(data);
  if (syncKey === 'profileSummary') return saveLearnerProfileSummary(data);
  if (syncKey === 'preferences') return savePreferences(data);
  if (syncKey === 'onboardingComplete' && data) return saveOnboardingComplete();
  if (syncKey.startsWith('courseKB:')) return saveCourseKB(syncKey.slice('courseKB:'.length), data);
  if (syncKey.startsWith('activities:')) {
    const courseId = syncKey.slice('activities:'.length);
    await deleteActivitiesForCourse(courseId);
    for (const activity of (Array.isArray(data) ? data : [data])) {
      await saveActivity(activity);
    }
    return;
  }
  if (syncKey.startsWith('activityKBs:')) {
    const courseId = syncKey.slice('activityKBs:'.length);
    await deleteActivityKBsForCourse(courseId);
    for (const kb of (Array.isArray(data) ? data : [data])) {
      await saveActivityKB(kb.activityId, courseId, kb);
    }
    return;
  }
  if (syncKey.startsWith('drafts:')) {
    const courseId = syncKey.slice('drafts:'.length);
    // saveScreenshot is statically imported above
    await deleteDraftsForCourse(courseId);
    for (const d of (Array.isArray(data) ? data : [data])) {
      if (d.screenshotDataUrl && d.screenshotKey) {
        await saveScreenshot(d.screenshotKey, d.screenshotDataUrl);
      }
      const { screenshotDataUrl, ...rest } = d;
      await saveDraft(rest);
    }
    return;
  }
  if (syncKey.startsWith('messages:')) {
    const courseId = syncKey.slice('messages:'.length);
    await clearCourseMessages(courseId);
    await saveCourseMessages(courseId, Array.isArray(data) ? data : [data]);
    return;
  }
}

function removeLocalData(syncKey) {
  if (syncKey === 'profile') return deleteProfile();
  if (syncKey === 'profileSummary') return deleteProfileSummary();
  if (syncKey === 'preferences') return deletePreferences();
}
