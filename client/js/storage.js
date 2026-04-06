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

// -- Lesson KB ----------------------------------------------------------------

export async function getLessonKB(lessonId) {
  return fetchSyncData(`lessonKB:${lessonId}`);
}

export async function saveLessonKB(lessonId, kb) {
  await putSyncData(`lessonKB:${lessonId}`, kb);
}

export async function deleteLessonKB(lessonId) {
  await deleteSyncData(`lessonKB:${lessonId}`);
}

// -- Activity KB --------------------------------------------------------------

export async function getActivityKB(activityId) {
  // Activity KBs are stored as part of the lesson's activityKBs collection.
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

export async function saveActivityKB(activityId, lessonId, kb) {
  const key = `activityKBs:${lessonId}`;
  let all = await fetchSyncData(key);
  if (!Array.isArray(all)) all = [];
  const idx = all.findIndex(k => k.activityId === activityId);
  const entry = { activityId, lessonId, ...kb };
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  await putSyncData(key, all);
}

export async function getActivityKBsForLesson(lessonId) {
  const data = await fetchSyncData(`activityKBs:${lessonId}`);
  return Array.isArray(data) ? data : [];
}

export async function deleteActivityKBsForLesson(lessonId) {
  await deleteSyncData(`activityKBs:${lessonId}`);
}

// -- Activities ---------------------------------------------------------------

export async function getActivities(lessonId) {
  const data = await fetchSyncData(`activities:${lessonId}`);
  return Array.isArray(data) ? data : [];
}

export async function saveActivity(activity) {
  const lessonId = activity.lessonId;
  const key = `activities:${lessonId}`;
  let all = await fetchSyncData(key);
  if (!Array.isArray(all)) all = [];
  const idx = all.findIndex(a => a.id === activity.id);
  if (idx >= 0) all[idx] = activity; else all.push(activity);
  await putSyncData(key, all);
}

export async function deleteActivitiesForLesson(lessonId) {
  await deleteSyncData(`activities:${lessonId}`);
}

// -- Drafts -------------------------------------------------------------------

export async function getDrafts(lessonId) {
  const data = await fetchSyncData(`drafts:${lessonId}`);
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
  const lessonId = draft.lessonId;
  const key = `drafts:${lessonId}`;
  let all = await fetchSyncData(key);
  if (!Array.isArray(all)) all = [];
  const idx = all.findIndex(d => d.id === draft.id);
  if (idx >= 0) all[idx] = draft; else all.push(draft);
  await putSyncData(key, all);
}

export async function deleteDraftsForLesson(lessonId) {
  await deleteSyncData(`drafts:${lessonId}`);
}

// -- Lesson messages (unified conversation per lesson) ------------------------

export async function getLessonMessages(lessonId) {
  const data = await fetchSyncData(`messages:${lessonId}`);
  return Array.isArray(data) ? data : [];
}

export async function saveLessonMessage(lessonId, msg) {
  const key = `messages:${lessonId}`;
  let all = _cache.get(key);
  if (!Array.isArray(all)) all = await getLessonMessages(lessonId);
  all = [...all, { ...msg, timestamp: msg.timestamp || Date.now() }];
  _cache.set(key, all);
  // Don't await — debounced sync handles persistence
}

export async function saveLessonMessages(lessonId, msgs) {
  const key = `messages:${lessonId}`;
  const withTimestamps = msgs.map(m => ({ ...m, timestamp: m.timestamp || Date.now() }));
  _cache.set(key, withTimestamps);
  await putSyncData(key, withTimestamps);
}

export async function clearLessonMessages(lessonId) {
  await deleteSyncData(`messages:${lessonId}`);
}

// -- User-created lessons -----------------------------------------------------

export async function saveUserLesson(lessonId, markdown) {
  await putSyncData(`lessons:${lessonId}`, { lessonId, markdown, createdAt: Date.now() });
}

export async function getUserLessons() {
  // Scan cache for all lessons:* keys, or fetch from loadAll
  const lessons = [];
  for (const [key, data] of _cache.entries()) {
    if (key.startsWith('lessons:') && data) {
      lessons.push(data);
    }
  }
  return lessons;
}

export async function getUserLessonMarkdown(lessonId) {
  const data = await fetchSyncData(`lessons:${lessonId}`);
  return data?.markdown || null;
}

export async function deleteUserLesson(lessonId) {
  await deleteSyncData(`lessons:${lessonId}`);
}

export async function getDraftLessonId() {
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

// -- Delete functions (used by sync.js and lesson reset) ----------------------

export async function deleteProfile() {
  await deleteSyncData('profile');
}

export async function deleteProfileSummary() {
  await deleteSyncData('profileSummary');
}

export async function deletePreferences() {
  await deleteSyncData('preferences');
}

export async function deleteLessonProgress(lessonId) {
  await deleteDraftsForLesson(lessonId);
  await deleteActivitiesForLesson(lessonId);
  await deleteActivityKBsForLesson(lessonId);
  await deleteLessonKB(lessonId);
  await clearLessonMessages(lessonId);
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
