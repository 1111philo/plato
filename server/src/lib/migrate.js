/**
 * Data migration: rename "course" to "lesson" in sync-data keys AND internal data fields.
 * Runs on server startup. Idempotent — skips if already migrated.
 */

import db from './db.js';

const KEY_RENAMES = [
  { from: /^course:/, to: 'lesson:' },
  { from: /^courseKB:/, to: 'lessonKB:' },
  { from: /^courses:/, to: 'lessons:' },
];

function migrateDataFields(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    let changed = false;
    const result = data.map(item => {
      const migrated = migrateDataFields(item);
      if (migrated !== item) changed = true;
      return migrated;
    });
    return changed ? result : data;
  }
  const renames = {
    courseId: 'lessonId',
    courseName: 'lessonName',
    courseDescription: 'lessonDescription',
    activeCourses: 'activeLessons',
    masteredCourses: 'masteredLessons',
  };
  const phaseRenames = { course_intro: 'lesson_intro' };
  let changed = false;
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    const newKey = renames[key] || key;
    let newValue = value;
    if (key === 'phase' && typeof value === 'string' && phaseRenames[value]) newValue = phaseRenames[value];
    if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) newValue = migrateDataFields(newValue);
    if (newKey !== key || newValue !== value) changed = true;
    result[newKey] = newValue;
  }
  return changed ? result : data;
}

export async function migrateCoursesToLessons() {
  let migrated = 0;
  const allUsers = new Set(['_system']);
  try {
    const users = await db.listUsers?.() || [];
    for (const u of users) allUsers.add(u.userId);
  } catch { /* listUsers may not exist on all backends */ }

  for (const userId of allUsers) {
    let items;
    try { items = await db.getAllSyncData(userId); } catch { continue; }
    if (!items?.length) continue;

    for (const item of items) {
      let newKey = item.dataKey;
      let keyChanged = false;
      for (const { from, to } of KEY_RENAMES) {
        if (from.test(item.dataKey)) {
          newKey = item.dataKey.replace(from, to);
          keyChanged = true;
          break;
        }
      }
      if (keyChanged) {
        const existing = await db.getSyncData(userId, newKey);
        if (existing) continue;
      }
      const migratedData = migrateDataFields(item.data);
      const dataChanged = migratedData !== item.data;
      if (keyChanged) {
        await db.putSyncData(userId, newKey, migratedData, 0);
        await db.deleteSyncData(userId, item.dataKey);
        migrated++;
      } else if (dataChanged) {
        await db.putSyncData(userId, item.dataKey, migratedData, item.version);
        migrated++;
      }
    }
  }
  return migrated;
}
