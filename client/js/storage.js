/**
 * Storage layer backed by server API (via sync endpoints).
 * All data is server-side. An in-memory cache avoids redundant fetches within a session.
 * Auth tokens use localStorage. Screenshots are embedded in draft data.
 */

import { authenticatedFetch } from './auth.js';

// -- In-memory cache ----------------------------------------------------------

const _cache = new Map();
const _versions = new Map();

export function clearCache() {
  _cache.clear();
  _versions.clear();
}

/** Used by sync.js loadAll() to bulk-populate the cache from server data. */
export function _populateCache(syncKey, data, version) {
  _cache.set(syncKey, data);
  _versions.set(syncKey, version);
}

async function fetchSyncData(syncKey) {
  if (_cache.has(syncKey)) return _cache.get(syncKey);
  try {
    const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`);
    if (!res.ok) return null;
    const item = await res.json();
    _cache.set(syncKey, item.data);
    _versions.set(syncKey, item.version);
    return item.data;
  } catch {
    return null;
  }
}

/** Write data to the server with optimistic locking. Also exported for syncDebounce. */
export async function putSyncData(syncKey, data) {
  _cache.set(syncKey, data);
  const version = _versions.get(syncKey) || 0;
  try {
    const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, version }),
    });
    if (res.ok) {
      const result = await res.json();
      _versions.set(syncKey, result.version);
    } else if (res.status === 409) {
      // Version conflict — fetch latest version and retry once
      const current = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`);
      if (current.ok) {
        const item = await current.json();
        _versions.set(syncKey, item.version);
        const retry = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data, version: item.version }),
        });
        if (retry.ok) {
          const retryResult = await retry.json();
          _versions.set(syncKey, retryResult.version);
        }
      }
    }
  } catch {
    // Write failed — cache is still updated for this session
  }
}

async function deleteSyncData(syncKey) {
  _cache.delete(syncKey);
  _versions.delete(syncKey);
  try {
    await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, { method: 'DELETE' });
  } catch { /* best effort */ }
}

// -- Preferences --------------------------------------------------------------

export async function getPreferences() {
  const data = await fetchSyncData('preferences');
  return data || { name: '' };
}

export async function savePreferences(prefs) {
  await putSyncData('preferences', prefs);
}

// -- Learner profile ----------------------------------------------------------

export async function getLearnerProfile() {
  return fetchSyncData('profile');
}

export async function saveLearnerProfile(profile) {
  await putSyncData('profile', profile);
}

export async function getLearnerProfileSummary() {
  const data = await fetchSyncData('profileSummary');
  return data || '';
}

export async function saveLearnerProfileSummary(summary) {
  await putSyncData('profileSummary', summary);
}

// -- Course KB ----------------------------------------------------------------

export async function getCourseKB(courseId) {
  return fetchSyncData(`courseKB:${courseId}`);
}

export async function saveCourseKB(courseId, kb) {
  await putSyncData(`courseKB:${courseId}`, kb);
}

export async function deleteCourseKB(courseId) {
  await deleteSyncData(`courseKB:${courseId}`);
}

// -- Activity KB --------------------------------------------------------------

export async function getActivityKB(activityId) {
  // Activity KBs are stored as part of the course's activityKBs collection.
  // Individual lookups scan the cache.
  for (const [key, data] of _cache.entries()) {
    if (!key.startsWith('activityKBs:')) continue;
    if (Array.isArray(data)) {
      const found = data.find(kb => kb.activityId === activityId);
      if (found) return found;
    }
  }
  return null;
}

export async function saveActivityKB(activityId, courseId, kb) {
  const key = `activityKBs:${courseId}`;
  let all = await fetchSyncData(key);
  if (!Array.isArray(all)) all = [];
  const idx = all.findIndex(k => k.activityId === activityId);
  const entry = { activityId, courseId, ...kb };
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  await putSyncData(key, all);
}

export async function getActivityKBsForCourse(courseId) {
  const data = await fetchSyncData(`activityKBs:${courseId}`);
  return Array.isArray(data) ? data : [];
}

export async function deleteActivityKBsForCourse(courseId) {
  await deleteSyncData(`activityKBs:${courseId}`);
}

// -- Activities ---------------------------------------------------------------

export async function getActivities(courseId) {
  const data = await fetchSyncData(`activities:${courseId}`);
  return Array.isArray(data) ? data : [];
}

export async function saveActivity(activity) {
  const courseId = activity.courseId;
  const key = `activities:${courseId}`;
  let all = await fetchSyncData(key);
  if (!Array.isArray(all)) all = [];
  const idx = all.findIndex(a => a.id === activity.id);
  if (idx >= 0) all[idx] = activity; else all.push(activity);
  await putSyncData(key, all);
}

export async function deleteActivitiesForCourse(courseId) {
  await deleteSyncData(`activities:${courseId}`);
}

// -- Drafts -------------------------------------------------------------------

export async function getDrafts(courseId) {
  const data = await fetchSyncData(`drafts:${courseId}`);
  return Array.isArray(data) ? data : [];
}

export async function getDraftsForActivity(activityId) {
  // Scan all draft collections in cache
  for (const [key, data] of _cache.entries()) {
    if (!key.startsWith('drafts:')) continue;
    if (Array.isArray(data)) {
      const matched = data.filter(d => d.activityId === activityId);
      if (matched.length > 0) return matched;
    }
  }
  return [];
}

export async function saveDraft(draft) {
  const courseId = draft.courseId;
  const key = `drafts:${courseId}`;
  let all = await fetchSyncData(key);
  if (!Array.isArray(all)) all = [];
  const idx = all.findIndex(d => d.id === draft.id);
  if (idx >= 0) all[idx] = draft; else all.push(draft);
  await putSyncData(key, all);
}

export async function deleteDraftsForCourse(courseId) {
  await deleteSyncData(`drafts:${courseId}`);
}

// -- Course messages (unified conversation per course) ------------------------

export async function getCourseMessages(courseId) {
  const data = await fetchSyncData(`messages:${courseId}`);
  return Array.isArray(data) ? data : [];
}

export async function saveCourseMessage(courseId, msg) {
  const key = `messages:${courseId}`;
  let all = _cache.get(key);
  if (!Array.isArray(all)) all = await getCourseMessages(courseId);
  all = [...all, { ...msg, timestamp: msg.timestamp || Date.now() }];
  _cache.set(key, all);
  // Don't await — debounced sync handles persistence
}

export async function saveCourseMessages(courseId, msgs) {
  const key = `messages:${courseId}`;
  const withTimestamps = msgs.map(m => ({ ...m, timestamp: m.timestamp || Date.now() }));
  _cache.set(key, withTimestamps);
  await putSyncData(key, withTimestamps);
}

export async function clearCourseMessages(courseId) {
  await deleteSyncData(`messages:${courseId}`);
}

// -- User-created courses -----------------------------------------------------

export async function saveUserCourse(courseId, markdown) {
  await putSyncData(`courses:${courseId}`, { courseId, markdown, createdAt: Date.now() });
}

export async function getUserCourses() {
  // Scan cache for all courses:* keys, or fetch from loadAll
  const courses = [];
  for (const [key, data] of _cache.entries()) {
    if (key.startsWith('courses:') && data) {
      courses.push(data);
    }
  }
  return courses;
}

export async function getUserCourseMarkdown(courseId) {
  const data = await fetchSyncData(`courses:${courseId}`);
  return data?.markdown || null;
}

export async function deleteUserCourse(courseId) {
  await deleteSyncData(`courses:${courseId}`);
}

export async function getDraftCourseId() {
  // Check cache for create:* message keys
  for (const key of _cache.keys()) {
    if (key.startsWith('messages:create:')) {
      return key.slice('messages:'.length);
    }
  }
  return null;
}

// -- Auth tokens (localStorage) -----------------------------------------------

const AUTH_STORAGE_KEY = 'plato_auth';

export async function getAuthTokens() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveAuthTokens({ accessToken, refreshToken }) {
  try {
    const existing = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      ...existing, accessToken, refreshToken,
    }));
  } catch { /* storage full or disabled */ }
}

export async function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  clearCache();
}

export async function getAuthUser() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored).user || null;
  } catch {
    return null;
  }
}

export async function saveAuthUser(user) {
  try {
    const existing = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...existing, user }));
  } catch { /* storage full or disabled */ }
}

// -- Onboarding ---------------------------------------------------------------

export async function getOnboardingComplete() {
  // With login required, onboarding is always considered complete
  return true;
}

export async function saveOnboardingComplete() {
  // No-op — login replaces onboarding
}

// -- Delete functions (used by sync.js and course reset) ----------------------

export async function deleteProfile() {
  await deleteSyncData('profile');
}

export async function deleteProfileSummary() {
  await deleteSyncData('profileSummary');
}

export async function deletePreferences() {
  await deleteSyncData('preferences');
}

export async function deleteCourseProgress(courseId) {
  await deleteDraftsForCourse(courseId);
  await deleteActivitiesForCourse(courseId);
  await deleteActivityKBsForCourse(courseId);
  await deleteCourseKB(courseId);
  await clearCourseMessages(courseId);
}

// -- Screenshots (embedded in drafts as base64) -------------------------------

export async function saveScreenshot(key, dataUrl) {
  // Screenshots are now stored as part of draft data (screenshotDataUrl field).
  // This function caches the dataUrl so it can be embedded when the draft is saved.
  _cache.set(`screenshot:${key}`, dataUrl);
}

export async function getScreenshot(key) {
  return _cache.get(`screenshot:${key}`) || null;
}
