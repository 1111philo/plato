/**
 * Sequential profile update queue — prevents concurrent updates from overwriting each other.
 */

import {
  getLearnerProfile, saveLearnerProfile, saveLearnerProfileSummary,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';

let _profileUpdateQueue = Promise.resolve();

export function queueProfileUpdate(fn) {
  _profileUpdateQueue = _profileUpdateQueue.then(fn).catch(e => {
    console.error('[plato] Profile update failed:', e?.message || e, e?.stack);
  });
  return _profileUpdateQueue;
}

function defaultProfile() {
  return {
    name: '', goal: '',
    masteredCourses: [], activeCourses: [],
    strengths: [], weaknesses: [],
    preferences: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function mergeProfile(existing, returned) {
  const merged = { ...existing };
  for (const key of ['name', 'goal']) {
    if (returned[key]) merged[key] = returned[key];
  }
  for (const key of ['masteredCourses', 'activeCourses']) {
    const combined = [...(existing[key] || []), ...(returned[key] || [])];
    merged[key] = [...new Set(combined)];
  }
  for (const key of ['strengths', 'weaknesses']) {
    merged[key] = (returned[key]?.length > 0) ? returned[key] : (existing[key] || []);
  }
  merged.preferences = { ...(existing.preferences || {}), ...(returned.preferences || {}) };
  merged.createdAt = existing.createdAt || returned.createdAt;
  merged.updatedAt = returned.updatedAt || Date.now();
  return merged;
}

async function saveProfileResult(existing, result) {
  if (!result?.profile) {
    console.error('[plato] Profile update agent returned no profile:', result);
    return;
  }
  const merged = mergeProfile(existing, result.profile);
  await saveLearnerProfile(merged);
  if (result.summary) await saveLearnerProfileSummary(result.summary);
  syncInBackground('profile', 'profileSummary');
}

export async function ensureProfileExists(name = '') {
  let profile = await getLearnerProfile();
  if (!profile) {
    profile = defaultProfile();
    profile.name = name;
    await saveLearnerProfile(profile);
    await saveLearnerProfileSummary('New learner — profile will be built as they learn.');
  }
  return profile;
}

/**
 * Incremental profile update after assessment (code, no LLM call).
 */
export function updateProfileInBackground(courseId, assessmentResult) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const updated = orchestrator.incrementalProfileUpdate(profile, courseId, assessmentResult);
    await saveLearnerProfile(updated);
    syncInBackground('profile');
  });
}

/**
 * Deep profile update on course completion (LLM call).
 */
export function updateProfileOnCompletionInBackground(courseKB, course) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileOnCompletion(
      profile, courseKB, course.name, course.courseId, courseKB.activitiesCompleted
    );
    await saveProfileResult(profile, result);
  });
}

/**
 * Profile update from a coach observation (LLM call).
 */
export function updateProfileFromObservation(courseKB, observation) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileFromFeedback(profile, observation, {
      courseName: courseKB.name || 'Course', activityType: 'coaching', activityGoal: 'Coach observation',
    });
    await saveProfileResult(profile, result);
  });
}

