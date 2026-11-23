/**
 * Output validators — pure functions for validating agent responses.
 */

export const UNSAFE_PATTERNS = /\b(kill\s+(yourself|your)|self[- ]?harm|suicide\s+method|how\s+to\s+(hack|steal|attack))\b/i;

export function validateSafety(text) {
  if (UNSAFE_PATTERNS.test(text)) return 'Response contains unsafe content.';
  return null;
}

/**
 * What validateLessonKB checks, in plain words, for the Trace (#595). Keep in
 * step with the function below (client/tests/validators.test.js).
 */
export const LESSON_KB_CHECKS = Object.freeze([
  'an exemplar: what finished work looks like',
  'at least one objective, each with its wording and what would count as evidence',
  'a starting note on where the learner is',
  'a list for the coach’s notes (empty to start)',
  'a count of exchanges, and the lesson’s status',
  'nothing in the exemplar or the starting note that matches plato’s unsafe-content patterns (self-harm, attacks, theft)',
]);

/**
 * Validate a lesson owner response (lesson KB initialization).
 */
export function validateLessonKB(parsed) {
  if (!parsed.exemplar || typeof parsed.exemplar !== 'string') return 'Missing exemplar.';
  if (!Array.isArray(parsed.objectives) || parsed.objectives.length === 0) return 'Missing objectives array.';
  for (let i = 0; i < parsed.objectives.length; i++) {
    const obj = parsed.objectives[i];
    if (!obj.objective || typeof obj.objective !== 'string') return `Objective ${i + 1} missing objective.`;
    if (!obj.evidence || typeof obj.evidence !== 'string') return `Objective ${i + 1} missing evidence.`;
  }
  if (!parsed.learnerPosition || typeof parsed.learnerPosition !== 'string') return 'Missing learnerPosition.';
  if (!Array.isArray(parsed.insights)) return 'Missing insights array.';
  if (typeof parsed.activitiesCompleted !== 'number') return 'Missing activitiesCompleted.';
  if (!parsed.status || typeof parsed.status !== 'string') return 'Missing status.';

  const safety = validateSafety(parsed.exemplar + ' ' + parsed.learnerPosition);
  if (safety) return safety;

  return null;
}
