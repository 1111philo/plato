/**
 * Sequential profile update queue — prevents concurrent updates from overwriting each other.
 */

import { tracedFollowUp, openTrace } from './traceSession.js';
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

async function saveProfileResult(existing, result, trace) {
  if (!result?.profile) {
    // null: the note was screened out (learnerNoteFilter), which is expected.
    if (result !== null) console.error('[plato] Profile update agent returned no profile:', result);
    trace?.step('profileUnchanged', { why: result === null ? 'the note was screened out, so the agent was not asked' : 'the agent returned no profile' });
    return;
  }
  const merged = mergeProfile(existing, result.profile);
  const savedProfile = await saveLearnerProfile(merged);
  syncIfUnsaved(savedProfile, 'profile');
  let savedSummary = null;
  if (result.summary) { savedSummary = await saveLearnerProfileSummary(result.summary); syncIfUnsaved(savedSummary, 'profileSummary'); }
  // The learner's own notes and the lesson lists are kept by code whatever the agent returned (mergeProfile).
  trace?.step('profileSaved', { before: existing, returned: result.profile, after: merged, summary: result.summary || null, saved: { profile: savedProfile, summary: savedSummary } });
}

// -- The learner's own notes (Settings → Learner Profile) ---------------------
//
// Each is its own Trace turn in the `profile` scope when Trace mode is on
// (#595): what the person did, the agent call, and what was saved.

/**
 * Add Feedback: keep the learner's words verbatim first (later updates can't
 * drop them), then let the profile agent revise the profile. Throws if the
 * agent call fails; the note itself is already saved by then.
 */
export async function addLearnerNote(text) {
  const trace = await openTrace('profile', 'profile');
  try {
    const profile = withLearnerNote(await ensureProfileExists(), text);
    const saved = await saveLearnerProfile(profile);
    syncIfUnsaved(saved, 'profile');
    trace?.step('noteChange', { action: 'added', text: String(text).trim(), saved: saved === true });
    const result = await orchestrator.updateProfileFromFeedback(profile, String(text).trim(), {
      lessonName: 'Settings', activityType: 'feedback', activityGoal: 'User-provided profile feedback',
    }, 'learner', trace ? { trace } : undefined);
    await saveProfileResult(profile, result, trace);
  } catch (e) {
    trace?.fail(e);
    throw e;
  } finally {
    trace?.flush();
  }
}

/**
 * Remove the note at `index`. The note goes at once; the profile agent then
 * revises the profile in the background so it stops following that note.
 * Returns `{ notes, done }` (`done` settles when the background update has),
 * or null when there is no such note. `onSummary` hears a rewritten summary.
 */
export async function removeLearnerNote(index, { onSummary } = {}) {
  const profile = await ensureProfileExists();
  const removed = profile.learnerNotes?.[index];
  if (!removed) return null;
  const next = withoutLearnerNote(profile, index);
  const saved = await saveLearnerProfile(next);
  syncIfUnsaved(saved, 'profile');
  const done = queueProfileUpdate(async () => {
    const trace = await openTrace('profile', 'profile');
    try {
      trace?.step('noteChange', { action: 'removed', text: removed.text, saved: saved === true });
      const current = await ensureProfileExists();
      const result = await orchestrator.updateProfileFromFeedback(current, removed.text, {
        lessonName: 'Settings', activityType: 'feedback', activityGoal: 'User removed a profile note',
      }, 'learner-removed', trace ? { trace } : undefined);
      await saveProfileResult(current, result, trace);
      if (result?.profile && result.summary) onSummary?.(result.summary);
    } catch (e) {
      trace?.fail(e);
      throw e;
    } finally {
      trace?.flush();
    }
  });
  return { notes: next.learnerNotes, done };
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
  queueProfileUpdate(() => tracedFollowUp(lesson.lessonId, 'learner-profile-owner', 'the lesson was completed', async (trace) => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileOnCompletion(
      profile, lessonKB, lesson.name, lesson.lessonId, lessonKB.activitiesCompleted, trace ? { trace } : undefined
    );
    // masteredLessons is system-managed (no longer echoed by the agent —
    // see orchestrator.profileForAgent). Record the completion in code so
    // mergeProfile unions it into the stored profile.
    if (result?.profile) {
      result.profile.masteredLessons = [...new Set([...(result.profile.masteredLessons || []), lesson.lessonId])];
    }
    await saveProfileResult(profile, result, trace);
  }));
}

/**
 * Profile update from a coach observation (LLM call).
 */
export function updateProfileFromObservation(lessonKB, observation) {
  // Traced under the lesson it came from, when the lesson is known.
  const run = async (trace) => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileFromFeedback(profile, observation, {
      lessonName: lessonKB.name || 'Lesson', activityType: 'coaching', activityGoal: 'Coach observation',
    }, 'coach', trace ? { trace } : undefined);
    await saveProfileResult(profile, result, trace);
  };
  queueProfileUpdate(() => (lessonKB?.lessonId ? tracedFollowUp(lessonKB.lessonId, 'learner-profile-update', 'the coach noted something about the learner', run) : run(undefined)));
}

