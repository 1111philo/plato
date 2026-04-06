/**
 * Data migration: rename "course" to "lesson" in sync-data keys AND internal data fields.
 * Runs on server startup. Idempotent — skips if already migrated.
 */

import db from './db.js';

const KEY_RENAMES = [
  { from: /^course:/, to: 'lesson:' },       // _system lesson definitions
  { from: /^courseKB:/, to: 'lessonKB:' },    // per-user lesson knowledge bases
  { from: /^courses:/, to: 'lessons:' },      // per-user custom lessons
];

/**
 * Rename fields inside a data object from course→lesson terminology.
 * Returns a new object if changes were made, or the original if not.
 */
function migrateDataFields(data) {
  if (!data || typeof data !== 'object') return data;

  // For arrays (e.g., message arrays), migrate each element
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

  // Also rename phase value
  const phaseRenames = {
    course_intro: 'lesson_intro',
  };

  let changed = false;
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    const newKey = renames[key] || key;
    let newValue = value;

    // Rename phase string values
    if (key === 'phase' && typeof value === 'string' && phaseRenames[value]) {
      newValue = phaseRenames[value];
    }

    // Recursively migrate nested objects (but not huge arrays like message content)
    if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
      newValue = migrateDataFields(newValue);
    }

    if (newKey !== key || newValue !== value) changed = true;
    result[newKey] = newValue;
  }

  return changed ? result : data;
}

export async function migrateCoursesToLessons() {
  let migrated = 0;

  // Get all users who have sync data (including _system)
  const allUsers = new Set(['_system']);
  try {
    const users = await db.listUsers?.() || [];
    for (const u of users) allUsers.add(u.userId);
  } catch { /* listUsers may not exist on all backends */ }

  for (const userId of allUsers) {
    let items;
    try {
      items = await db.getAllSyncData(userId);
    } catch { continue; }
    if (!items?.length) continue;

    for (const item of items) {
      let newKey = item.dataKey;
      let keyChanged = false;

      // Rename key if it matches old pattern
      for (const { from, to } of KEY_RENAMES) {
        if (from.test(item.dataKey)) {
          newKey = item.dataKey.replace(from, to);
          keyChanged = true;
          break;
        }
      }

      // If key changed, check if new key already exists
      if (keyChanged) {
        const existing = await db.getSyncData(userId, newKey);
        if (existing) continue;
      }

      // Migrate internal data fields
      const migratedData = migrateDataFields(item.data);
      const dataChanged = migratedData !== item.data;

      if (keyChanged) {
        // Write new key with migrated data, delete old
        await db.putSyncData(userId, newKey, migratedData, 0);
        await db.deleteSyncData(userId, item.dataKey);
        migrated++;
      } else if (dataChanged) {
        // Same key, but internal fields changed — update in place
        await db.putSyncData(userId, item.dataKey, migratedData, item.version);
        migrated++;
      }

      // Also migrate profile and profileSummary records (they contain activeCourses, masteredCourses)
      if (item.dataKey === 'profile' || item.dataKey === 'profileSummary') {
        // Already handled by migrateDataFields above via dataChanged check
      }
    }
  }

  return migrated;
}
