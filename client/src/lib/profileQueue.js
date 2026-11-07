/**
 * Sequential profile update queue — prevents concurrent updates from overwriting each other.
 */

import {
  getLearnerProfile, saveLearnerProfile, saveLearnerProfileSummary,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncIfUnsaved } from './syncDebounce.js';

let _profileUpdateQueue = Promise.resolve();

// The learner's own notes about themselves (Settings → Learner Profile → Add
// Feedback), kept verbatim. The profile agents read them and must keep the
// profile consistent with them, but can't change or drop them: mergeProfile
// always keeps the stored list. Newest last.
export const MAX_LEARNER_NOTES = 10;
export const MAX_LEARNER_NOTE_LENGTH = 500;

/** The profile with one more learner note (trimmed, capped). Pure. */
export function withLearnerNote(profile, text, at = Date.now()) {
  const note = String(text || '').trim().slice(0, MAX_LEARNER_NOTE_LENGTH);
  if (!note) return profile;
  const notes = [...(Array.isArray(profile?.learnerNotes) ? profile.learnerNotes : []), { text: note, at }];
  return { ...profile, learnerNotes: notes.slice(-MAX_LEARNER_NOTES) };
}

/** The profile without the note at `index`. Pure. */
export function withoutLearnerNote(profile, index) {
  const notes = Array.isArray(profile?.learnerNotes) ? profile.learnerNotes : [];
  return { ...profile, learnerNotes: notes.filter((_, i) => i !== index) };
}

export function queueProfileUpdate(fn) {
  _profileUpdateQueue = _profileUpdateQueue.then(fn).catch(e => {
    console.error('[plato] Profile update failed:', e?.message || e, e?.stack);
  });
  return _profileUpdateQueue;
}

function defaultProfile() {
  return {
    name: '', goal: '',
    masteredLessons: [], activeLessons: [],
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
  for (const key of ['masteredLessons', 'activeLessons']) {
    const combined = [...(existing[key] || []), ...(returned[key] || [])];
    merged[key] = [...new Set(combined)];
  }
  for (const key of ['strengths', 'weaknesses']) {
    merged[key] = (returned[key]?.length > 0) ? returned[key] : (existing[key] || []);
  }
  merged.preferences = { ...(existing.preferences || {}), ...(returned.preferences || {}) };
  // The learner's own notes are theirs: an agent's copy is ignored.
  if (Array.isArray(existing.learnerNotes)) merged.learnerNotes = existing.learnerNotes;
  else delete merged.learnerNotes;
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
  syncIfUnsaved(await saveLearnerProfile(merged), 'profile');
  if (result.summary) syncIfUnsaved(await saveLearnerProfileSummary(result.summary), 'profileSummary');
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
export function updateProfileInBackground(lessonId, assessmentResult) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const updated = orchestrator.incrementalProfileUpdate(profile, lessonId, assessmentResult);
    syncIfUnsaved(await saveLearnerProfile(updated), 'profile');
  });
}

/**
 * Deep profile update on lesson completion (LLM call).
 */
export function updateProfileOnCompletionInBackground(lessonKB, lesson) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileOnCompletion(
      profile, lessonKB, lesson.name, lesson.lessonId, lessonKB.activitiesCompleted
    );
    // masteredLessons is system-managed (no longer echoed by the agent —
    // see orchestrator.profileForAgent). Record the completion in code so
    // mergeProfile unions it into the stored profile.
    if (result?.profile) {
      result.profile.masteredLessons = [...new Set([...(result.profile.masteredLessons || []), lesson.lessonId])];
    }
    await saveProfileResult(profile, result);
  });
}

/**
 * Profile update from a coach observation (LLM call).
 */
export function updateProfileFromObservation(lessonKB, observation) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileFromFeedback(profile, observation, {
      lessonName: lessonKB.name || 'Lesson', activityType: 'coaching', activityGoal: 'Coach observation',
    }, 'coach');
    await saveProfileResult(profile, result);
  });
}

