/**
 * Storage layer backed by sql.js (SQLite WASM).
 * Screenshots remain in IndexedDB — referenced by key in the drafts table.
 */

import { run, query, queryAll, persist } from './db.js';

// -- Preferences --------------------------------------------------------------

export async function getPreferences() {
  const row = query('SELECT data FROM preferences WHERE id = 1');
  return row ? JSON.parse(row.data) : { name: '' };
}

export async function savePreferences(prefs) {
  run(
    'INSERT OR REPLACE INTO preferences (id, data, updated_at) VALUES (1, ?, ?)',
    [JSON.stringify(prefs), Date.now()]
  );
}

// -- API key ------------------------------------------------------------------

export async function getApiKey() {
  const row = query("SELECT value FROM settings WHERE key = 'apiKey'");
  return row ? JSON.parse(row.value) : null;
}

export async function saveApiKey(key) {
  run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('apiKey', ?)",
    [JSON.stringify(key)]
  );
}

// -- Learner profile ----------------------------------------------------------

export async function getLearnerProfile() {
  const row = query('SELECT data FROM profile WHERE id = 1');
  return row ? JSON.parse(row.data) : null;
}

export async function saveLearnerProfile(profile) {
  run(
    'INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (1, ?, ?)',
    [JSON.stringify(profile), Date.now()]
  );
}

export async function getLearnerProfileSummary() {
  const row = query('SELECT summary FROM profile_summary WHERE id = 1');
  return row ? row.summary : '';
}

export async function saveLearnerProfileSummary(summary) {
  run(
    'INSERT OR REPLACE INTO profile_summary (id, summary, updated_at) VALUES (1, ?, ?)',
    [summary, Date.now()]
  );
}

// -- Course KB ----------------------------------------------------------------

export async function getCourseKB(courseId) {
  const row = query('SELECT kb FROM course_kbs WHERE course_id = ?', [courseId]);
  return row ? JSON.parse(row.kb) : null;
}

export async function saveCourseKB(courseId, kb) {
  run(
    'INSERT OR REPLACE INTO course_kbs (course_id, kb, updated_at) VALUES (?, ?, ?)',
    [courseId, JSON.stringify(kb), Date.now()]
  );
}

export async function deleteCourseKB(courseId) {
  run('DELETE FROM course_kbs WHERE course_id = ?', [courseId]);
}

// -- Activity KB --------------------------------------------------------------

export async function getActivityKB(activityId) {
  const row = query('SELECT kb FROM activity_kbs WHERE activity_id = ?', [activityId]);
  return row ? JSON.parse(row.kb) : null;
}

export async function saveActivityKB(activityId, courseId, kb) {
  run(
    'INSERT OR REPLACE INTO activity_kbs (activity_id, course_id, kb, updated_at) VALUES (?, ?, ?, ?)',
    [activityId, courseId, JSON.stringify(kb), Date.now()]
  );
}

export async function getActivityKBsForCourse(courseId) {
  const rows = queryAll('SELECT * FROM activity_kbs WHERE course_id = ? ORDER BY activity_id', [courseId]);
  return rows.map(r => ({ activityId: r.activity_id, courseId: r.course_id, ...JSON.parse(r.kb) }));
}

export async function deleteActivityKBsForCourse(courseId) {
  run('DELETE FROM activity_kbs WHERE course_id = ?', [courseId]);
}

// -- Activities ---------------------------------------------------------------

export async function getActivities(courseId) {
  const rows = queryAll(
    'SELECT * FROM activities WHERE course_id = ? ORDER BY activity_number',
    [courseId]
  );
  return rows.map(r => ({
    id: r.id,
    courseId: r.course_id,
    activityNumber: r.activity_number,
    instruction: r.instruction,
    tips: r.tips ? JSON.parse(r.tips) : [],
    objectiveFocus: r.objective_focus,
    createdAt: r.created_at,
  }));
}

export async function saveActivity(activity) {
  run(
    `INSERT OR REPLACE INTO activities
     (id, course_id, activity_number, instruction, tips, objective_focus, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      activity.id,
      activity.courseId,
      activity.activityNumber,
      activity.instruction || null,
      activity.tips ? JSON.stringify(activity.tips) : null,
      activity.objectiveFocus || null,
      activity.createdAt || Date.now(),
    ]
  );
}

export async function deleteActivitiesForCourse(courseId) {
  run('DELETE FROM activities WHERE course_id = ?', [courseId]);
}

// -- Drafts -------------------------------------------------------------------

export async function getDrafts(courseId) {
  const rows = queryAll(
    'SELECT * FROM drafts WHERE course_id = ? ORDER BY timestamp',
    [courseId]
  );
  return rows.map(r => ({
    id: r.id,
    activityId: r.activity_id,
    courseId: r.course_id,
    screenshotKey: r.screenshot_key || null,
    textResponse: r.text_response || null,
    url: r.url || null,
    achieved: !!r.achieved,
    demonstrates: r.demonstrates || null,
    moved: r.moved || null,
    needed: r.needed || null,
    strengths: r.strengths ? JSON.parse(r.strengths) : [],
    attempt: r.attempt || 1,
    timestamp: r.timestamp,
  }));
}

export async function getDraftsForActivity(activityId) {
  const rows = queryAll(
    'SELECT * FROM drafts WHERE activity_id = ? ORDER BY timestamp',
    [activityId]
  );
  return rows.map(r => ({
    id: r.id,
    activityId: r.activity_id,
    courseId: r.course_id,
    screenshotKey: r.screenshot_key || null,
    textResponse: r.text_response || null,
    url: r.url || null,
    achieved: !!r.achieved,
    demonstrates: r.demonstrates || null,
    moved: r.moved || null,
    needed: r.needed || null,
    strengths: r.strengths ? JSON.parse(r.strengths) : [],
    attempt: r.attempt || 1,
    timestamp: r.timestamp,
  }));
}

export async function saveDraft(draft) {
  run(
    `INSERT OR REPLACE INTO drafts
     (id, activity_id, course_id, screenshot_key, text_response, url,
      achieved, demonstrates, moved, needed, strengths, attempt, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.activityId,
      draft.courseId,
      draft.screenshotKey || null,
      draft.textResponse || null,
      draft.url || null,
      draft.achieved ? 1 : 0,
      draft.demonstrates || null,
      draft.moved || null,
      draft.needed || null,
      draft.strengths ? JSON.stringify(draft.strengths) : null,
      draft.attempt || 1,
      draft.timestamp || Date.now(),
    ]
  );
}

export async function deleteDraftsForCourse(courseId) {
  run('DELETE FROM drafts WHERE course_id = ?', [courseId]);
}

// -- Course messages (unified conversation per course) ------------------------

export async function getCourseMessages(courseId) {
  const rows = queryAll(
    'SELECT * FROM course_messages WHERE course_id = ? ORDER BY timestamp',
    [courseId]
  );
  return rows.map(r => ({
    id: r.id,
    courseId: r.course_id,
    role: r.role,
    content: r.content,
    msgType: r.msg_type,
    phase: r.phase,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    timestamp: r.timestamp,
  }));
}

export async function saveCourseMessage(courseId, msg) {
  run(
    `INSERT INTO course_messages (course_id, role, content, msg_type, phase, metadata, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      courseId,
      msg.role,
      msg.content || '',
      msg.msgType,
      msg.phase || null,
      msg.metadata ? JSON.stringify(msg.metadata) : null,
      msg.timestamp || Date.now(),
    ]
  );
}

export async function saveCourseMessages(courseId, msgs) {
  for (const msg of msgs) {
    await saveCourseMessage(courseId, msg);
  }
}

export async function clearCourseMessages(courseId) {
  run('DELETE FROM course_messages WHERE course_id = ?', [courseId]);
}

// -- User-created courses -----------------------------------------------------

export async function saveUserCourse(courseId, markdown) {
  run(
    'INSERT OR REPLACE INTO courses (course_id, markdown, created_at) VALUES (?, ?, ?)',
    [courseId, markdown, Date.now()]
  );
}

export async function getUserCourses() {
  return queryAll('SELECT * FROM courses ORDER BY created_at');
}

export async function getUserCourseMarkdown(courseId) {
  const row = query('SELECT markdown FROM courses WHERE course_id = ?', [courseId]);
  return row ? row.markdown : null;
}

export async function deleteUserCourse(courseId) {
  run('DELETE FROM courses WHERE course_id = ?', [courseId]);
}

export async function getDraftCourseId() {
  const row = query(
    "SELECT course_id FROM course_messages WHERE course_id LIKE 'create:%' ORDER BY timestamp DESC LIMIT 1"
  );
  return row ? row.course_id : null;
}

// -- Auth tokens (cloud sync) -------------------------------------------------

export async function getAuthTokens() {
  const row = query('SELECT access_token, refresh_token FROM auth WHERE id = 1');
  if (!row || !row.access_token) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token };
}

export async function saveAuthTokens({ accessToken, refreshToken }) {
  const existing = query('SELECT id FROM auth WHERE id = 1');
  if (existing) {
    run(
      'UPDATE auth SET access_token = ?, refresh_token = ? WHERE id = 1',
      [accessToken, refreshToken]
    );
  } else {
    run(
      'INSERT INTO auth (id, access_token, refresh_token) VALUES (1, ?, ?)',
      [accessToken, refreshToken]
    );
  }
}

export async function clearAuth() {
  run('DELETE FROM auth WHERE id = 1');
}

export async function getAuthUser() {
  const row = query('SELECT user_json FROM auth WHERE id = 1');
  return row?.user_json ? JSON.parse(row.user_json) : null;
}

export async function saveAuthUser(user) {
  const existing = query('SELECT id FROM auth WHERE id = 1');
  if (existing) {
    run('UPDATE auth SET user_json = ? WHERE id = 1', [JSON.stringify(user)]);
  } else {
    run('INSERT INTO auth (id, user_json) VALUES (1, ?)', [JSON.stringify(user)]);
  }
}

// -- Onboarding ---------------------------------------------------------------

export async function getOnboardingComplete() {
  const row = query("SELECT value FROM settings WHERE key = 'onboardingComplete'");
  return row ? JSON.parse(row.value) : false;
}

export async function saveOnboardingComplete() {
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboardingComplete', ?)", [JSON.stringify(true)]);
}

// -- Delete functions (used by sync.js and course reset) ----------------------

export async function deleteProfile() {
  run('DELETE FROM profile WHERE id = 1');
}

export async function deleteProfileSummary() {
  run('DELETE FROM profile_summary WHERE id = 1');
}

export async function deletePreferences() {
  run('DELETE FROM preferences WHERE id = 1');
}

export async function deleteCourseProgress(courseId) {
  await deleteDraftsForCourse(courseId);
  await deleteActivitiesForCourse(courseId);
  await deleteActivityKBsForCourse(courseId);
  await deleteCourseKB(courseId);
  await clearCourseMessages(courseId);
}

// -- IndexedDB for binary assets (screenshots) --------------------------------

const DB_NAME = '1111-blobs';
const DB_VERSION = 1;
const STORE_NAME = 'screenshots';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScreenshot(key, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getScreenshot(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
