/**
 * Storage layer backed by server API (via sync endpoints).
 * All data is server-side. An in-memory cache avoids redundant fetches within a session.
 * Auth tokens use localStorage. Screenshots are embedded in draft data.
 */

import { authenticatedFetch } from './auth.js';

// -- In-memory cache ----------------------------------------------------------

const _cache = new Map();
const _versions = new Map();

export class SyncConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SyncConflictError';
    Object.assign(this, details);
  }
}

function randomId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}${globalThis.crypto.randomUUID()}`;
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function lessonSessionKey(lessonId) {
  return `lessonSession:${lessonId}`;
}

function createLessonSession(lessonId, generation = 1) {
  const now = Date.now();
  return {
    lessonId,
    lessonSessionId: randomId('lesson-session-'),
    generation,
    createdAt: now,
    updatedAt: now,
  };
}

function isLessonSession(data) {
  return !!data
    && typeof data.lessonId === 'string'
    && typeof data.lessonSessionId === 'string'
    && typeof data.generation === 'number';
}

function buildLessonGuard(lessonSession) {
  return lessonSession ? { lessonSessionId: lessonSession.lessonSessionId } : null;
}

function decorateLessonKB(kb, lessonSession) {
  if (!lessonSession || !kb || typeof kb !== 'object') return kb;
  return {
    ...kb,
    lessonSessionId: lessonSession.lessonSessionId,
    lessonSessionGeneration: lessonSession.generation,
  };
}

function decorateLessonMessages(messages, lessonSession) {
  if (!lessonSession) return messages;
  return messages.map((message) => ({
    ...message,
    lessonSessionId: lessonSession.lessonSessionId,
    lessonSessionGeneration: lessonSession.generation,
    messageId: message.messageId || randomId('lesson-msg-'),
  }));
}

function appendUniqueMessages(existing, incoming) {
  const merged = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(merged.map((message) => message?.messageId).filter(Boolean));
  for (const message of incoming) {
    if (message?.messageId && seen.has(message.messageId)) continue;
    merged.push(message);
    if (message?.messageId) seen.add(message.messageId);
  }
  return merged;
}

function lessonSessionConflictError(lessonId, lessonSession) {
  return new SyncConflictError(
    'Lesson session conflict. This lesson was reset or changed in another tab. Reload the lesson to continue without losing progress.',
    {
      code: 'stale_lesson_session',
      conflict: 'stale_session',
      lessonId,
      lessonSession,
    }
  );
}

export function clearCache() {
  _cache.clear();
  _versions.clear();
}

/** Used by sync.js loadAll() to bulk-populate the cache from server data. */
export function _populateCache(syncKey, data, version) {
  _cache.set(syncKey, data);
  _versions.set(syncKey, version);
}

async function fetchSyncItem(syncKey, { preferCache = true } = {}) {
  if (preferCache && _cache.has(syncKey)) {
    return { data: _cache.get(syncKey), version: _versions.get(syncKey) || 0 };
  }
  try {
    const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`);
    if (!res.ok) return { data: null, version: 0 };
    const item = await res.json();
    _cache.set(syncKey, item.data);
    _versions.set(syncKey, item.version);
    return { data: item.data, version: item.version };
  } catch {
    return { data: null, version: 0 };
  }
}

async function fetchSyncData(syncKey, options) {
  const item = await fetchSyncItem(syncKey, options);
  return item.data;
}

/** Write data to the server with optimistic locking. Also exported for syncDebounce. */
export async function putSyncData(syncKey, data, options = {}) {
  const {
    version = _versions.get(syncKey) || 0,
    guard = null,
    retryOnConflict = true,
    optimistic = true,
  } = options;

  if (optimistic) _cache.set(syncKey, data);

  const requestBody = { data, version };
  if (guard) requestBody.guard = guard;

  try {
    const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (res.ok) {
      const result = await res.json();
      _cache.set(syncKey, data);
      _versions.set(syncKey, result.version);
      return { ok: true, version: result.version, updatedAt: result.updatedAt };
    }

    if (res.status === 409) {
      const conflict = await res.json().catch(() => ({}));
      if (typeof conflict.serverVersion === 'number') {
        _versions.set(syncKey, conflict.serverVersion);
      }

      if (!retryOnConflict || conflict.conflict === 'stale_session') {
        return {
          ok: false,
          conflict: conflict.conflict || 'version',
          serverVersion: conflict.serverVersion ?? null,
          lessonSession: conflict.lessonSession ?? null,
          error: conflict.error || 'Version conflict',
        };
      }

      // Version conflict — fetch latest version and retry once
      const current = await fetchSyncItem(syncKey, { preferCache: false });
      const retry = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          version: current.version || 0,
          ...(guard ? { guard } : {}),
        }),
      });

      if (retry.ok) {
        const retryResult = await retry.json();
        _cache.set(syncKey, data);
        _versions.set(syncKey, retryResult.version);
        return { ok: true, version: retryResult.version, updatedAt: retryResult.updatedAt };
      }

      const retryConflict = await retry.json().catch(() => ({}));
      return {
        ok: false,
        conflict: retryConflict.conflict || 'version',
        serverVersion: retryConflict.serverVersion ?? null,
        lessonSession: retryConflict.lessonSession ?? null,
        error: retryConflict.error || 'Version conflict',
      };
    }

    return { ok: false, error: `Sync failed with status ${res.status}` };
  } catch {
    // Write failed — cache is still updated for this session
    return { ok: false, error: 'network_error' };
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

export async function getLessonSession(lessonId, options) {
  const data = await fetchSyncData(lessonSessionKey(lessonId), options);
  return isLessonSession(data) ? data : null;
}

export async function ensureLessonSession(lessonId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await fetchSyncItem(lessonSessionKey(lessonId), { preferCache: attempt === 0 });
    if (isLessonSession(item.data)) return item.data;

    const next = createLessonSession(lessonId, (item.data?.generation || 0) + 1);
    const result = await putSyncData(lessonSessionKey(lessonId), next, {
      version: item.version || 0,
      retryOnConflict: false,
      optimistic: false,
    });
    if (result.ok) return next;
    if (result.conflict === 'version') continue;
    throw new Error(`Failed to create a lesson session for ${lessonId}.`);
  }
  throw new Error(`Failed to create a lesson session for ${lessonId}.`);
}

async function rotateLessonSession(lessonId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await fetchSyncItem(lessonSessionKey(lessonId), { preferCache: false });
    const current = isLessonSession(item.data) ? item.data : null;
    const next = createLessonSession(lessonId, (current?.generation || 0) + 1);
    const result = await putSyncData(lessonSessionKey(lessonId), next, {
      version: item.version || 0,
      retryOnConflict: false,
      optimistic: false,
    });
    if (result.ok) return next;
    if (result.conflict === 'version') continue;
    throw new Error(`Failed to rotate the lesson session for ${lessonId}.`);
  }
  throw new Error(`Failed to rotate the lesson session for ${lessonId}.`);
}

export async function getLessonKB(lessonId, options) {
  return fetchSyncData(`lessonKB:${lessonId}`, options);
}

export async function saveLessonKB(lessonId, kb, { lessonSession, version, retryOnConflict = true, optimistic = true } = {}) {
  const payload = decorateLessonKB(kb, lessonSession);
  const result = await putSyncData(`lessonKB:${lessonId}`, payload, {
    version,
    guard: buildLessonGuard(lessonSession),
    retryOnConflict,
    optimistic,
  });
  if (!lessonSession) return payload;
  if (result.ok) return payload;
  if (result.conflict === 'stale_session') {
    throw lessonSessionConflictError(lessonId, result.lessonSession);
  }
  throw new SyncConflictError('Lesson KB version conflict.', {
    code: 'lesson_kb_version_conflict',
    conflict: result.conflict,
    lessonId,
  });
}

export async function deleteLessonKB(lessonId) {
  await deleteSyncData(`lessonKB:${lessonId}`);
}

export async function updateLessonKB(lessonId, updater, { lessonSession, preferCache = true, maxAttempts = 3 } = {}) {
  if (!lessonSession) {
    const previousLessonKB = await getLessonKB(lessonId, { preferCache });
    const lessonKB = updater(previousLessonKB);
    await saveLessonKB(lessonId, lessonKB);
    return { lessonKB, previousLessonKB };
  }

  const key = `lessonKB:${lessonId}`;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await fetchSyncItem(key, { preferCache: attempt === 0 ? preferCache : false });
    const previousLessonKB = current.data;
    const lessonKB = decorateLessonKB(updater(previousLessonKB), lessonSession);
    const result = await putSyncData(key, lessonKB, {
      version: current.version || 0,
      guard: buildLessonGuard(lessonSession),
      retryOnConflict: false,
      optimistic: false,
    });

    if (result.ok) return { lessonKB, previousLessonKB, version: result.version };
    if (result.conflict === 'version') continue;
    if (result.conflict === 'stale_session') {
      throw lessonSessionConflictError(lessonId, result.lessonSession);
    }
    throw new Error(`Failed to save lesson progress for ${lessonId}.`);
  }

  throw new SyncConflictError('Lesson KB stayed in conflict after multiple retries.', {
    code: 'lesson_kb_conflict_exhausted',
    conflict: 'version',
    lessonId,
  });
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

export async function getLessonMessages(lessonId, options) {
  const data = await fetchSyncData(`messages:${lessonId}`, options);
  return Array.isArray(data) ? data : [];
}

export async function saveLessonMessages(lessonId, msgs, { lessonSession } = {}) {
  const key = `messages:${lessonId}`;

  if (!lessonSession) {
    let all = _cache.get(key);
    if (!Array.isArray(all)) all = await getLessonMessages(lessonId);
    const withTimestamps = msgs.map((m) => ({ ...m, timestamp: m.timestamp || Date.now() }));
    all = [...all, ...withTimestamps];
    _cache.set(key, all);
    await putSyncData(key, all);
    return all;
  }

  const prepared = decorateLessonMessages(
    msgs.map((message) => ({ ...message, timestamp: message.timestamp || Date.now() })),
    lessonSession
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await fetchSyncItem(key, { preferCache: attempt === 0 });
    const existing = Array.isArray(current.data) ? current.data : [];
    const merged = appendUniqueMessages(existing, prepared);
    const result = await putSyncData(key, merged, {
      version: current.version || 0,
      guard: buildLessonGuard(lessonSession),
      retryOnConflict: false,
      optimistic: false,
    });

    if (result.ok) return merged;
    if (result.conflict === 'version') continue;
    if (result.conflict === 'stale_session') {
      throw lessonSessionConflictError(lessonId, result.lessonSession);
    }
    throw new Error(`Failed to save lesson messages for ${lessonId}.`);
  }

  throw new SyncConflictError('Lesson messages stayed in conflict after multiple retries.', {
    code: 'lesson_messages_conflict_exhausted',
    conflict: 'version',
    lessonId,
  });
}

export async function clearLessonMessages(lessonId) {
  await deleteSyncData(`messages:${lessonId}`);
}

// -- User-created lessons -----------------------------------------------------

export async function saveUserLesson(lessonId, markdown) {
  await putSyncData(`lessons:${lessonId}`, { lessonId, markdown, createdAt: Date.now() });
}

export async function getUserLessons() {
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
  await rotateLessonSession(lessonId);
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
