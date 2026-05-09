/**
 * Lesson engine — conversational coaching toward the exemplar.
 *
 * 1. Lesson starts: Lesson Owner generates KB, Coach opens conversation
 * 2. Learner responds (text or image)
 * 3. Coach evaluates, coaches forward, updates KB + progress
 * 4. Repeat until exemplar achieved
 */

import {
  getLearnerProfileSummary, getPreferences,
  getLessonKB, saveLessonKB,
  saveScreenshot,
  saveLessonMessages, getLessonMessages,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';
import { ensureProfileExists, updateProfileOnCompletionInBackground, updateProfileFromObservation } from './profileQueue.js';
import { LESSON_PHASES, MSG_TYPES, MAX_EXCHANGES } from './constants.js';

function ts() { return Date.now(); }

/**
 * Defense-in-depth guard for the "View as User" admin feature: if the SPA
 * is currently impersonating a learner, no write paths in the lesson engine
 * may execute — they would corrupt the impersonated learner's record using
 * the admin's own JWT (which is what the Function URL actually authorizes
 * against). The compose bar is also disabled in the UI; this guard catches
 * programmatic / future-bug callers.
 */
function assertNotImpersonating(action) {
  if (typeof sessionStorage === 'undefined') return;
  if (sessionStorage.getItem('plato_impersonation')) {
    throw new Error(`Cannot ${action} while viewing as another user`);
  }
}

// Bedrock hard limit for base64-encoded image payloads.
// 5 MB decoded = 5 * 1024 * 1024 bytes. Base64 string length * 3/4 ≈ decoded bytes.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Throw a learner-friendly error if an image data URL decodes to more than
 * 5 MB — Bedrock rejects larger images with a cryptic ValidationException.
 * Returns silently for non-image URLs or URLs without a parseable base64 body.
 */
export function assertImageWithinBedrockLimit(imageDataUrl) {
  if (!imageDataUrl) return;
  const match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return;
  const estimatedBytes = Math.floor(match[1].length * 3 / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large (${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB). ` +
      `Please resize it to under 5 MB and try again.`
    );
  }
}

// -- Tag parsing --------------------------------------------------------------

// Detects where the coach tag section begins (tags always come at the end)
const TAG_SECTION_REGEX = /\n?\[(?:PROGRESS|KB_UPDATE|PROFILE_UPDATE)[:\s]/;

/**
 * Extract a JSON object from text starting after startPos, using bracket
 * counting so that }] inside string values doesn't confuse the parser.
 */
function extractBracketedJSON(text, startPos) {
  let i = startPos;
  while (i < text.length && /\s/.test(text[i])) i++; // skip whitespace
  if (text[i] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  const start = i;

  while (i < text.length) {
    const ch = text[i];
    if (escape) { escape = false; }
    else if (ch === '\\' && inString) { escape = true; }
    else if (ch === '"') { inString = !inString; }
    else if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    i++;
  }
  return null;
}

/** Strip the tag section from raw coach output, returning only the visible text. */
function stripTags(text) {
  const tagStart = text.search(TAG_SECTION_REGEX);
  return (tagStart !== -1 ? text.slice(0, tagStart) : text).trim();
}

export function parseCoachResponse(raw) {
  let progress = null;
  let kbUpdate = null;
  let profileUpdate = null;

  // Extract progress
  const progressMatch = raw.match(/\[PROGRESS:\s*(\d+)\]/);
  if (progressMatch) progress = parseInt(progressMatch[1], 10);

  // Extract KB update — bracket-aware so }] inside string values don't mislead
  const kbIdx = raw.indexOf('[KB_UPDATE:');
  if (kbIdx !== -1) {
    const jsonStr = extractBracketedJSON(raw, kbIdx + '[KB_UPDATE:'.length);
    if (jsonStr) { try { kbUpdate = JSON.parse(jsonStr); } catch { /* ignore */ } }
  }

  // Extract profile update
  const profIdx = raw.indexOf('[PROFILE_UPDATE:');
  if (profIdx !== -1) {
    const jsonStr = extractBracketedJSON(raw, profIdx + '[PROFILE_UPDATE:'.length);
    if (jsonStr) { try { profileUpdate = JSON.parse(jsonStr); } catch { /* ignore */ } }
  }

  return { text: stripTags(raw), progress, kbUpdate, profileUpdate };
}

/**
 * Wrap a stream callback to strip tags from partial accumulated text.
 * Tags always appear at the end of the response — truncate there.
 */
export function cleanStream(onStream) {
  if (!onStream) return () => {};
  return (partial) => onStream(stripTags(partial));
}

// -- Pacing directives --------------------------------------------------------

/**
 * Returns a pacing directive string for the coach based on how many exchanges
 * have occurred. Directives escalate in urgency as exchanges accumulate.
 *
 * These are strong suggestions to the coach, never hard cutoffs — completion
 * still requires progress >= 10 awarded by the coach. Philosophy: "move
 * people, not force people."
 *
 * Thresholds are tuned to the MAX_EXCHANGES=11 target:
 *   < 8   — no directive (normal coaching)
 *   8–10  — begin winding down; focus on weakest objective
 *   11–14 — at target; push for closure or award progress if criteria are met
 *   15–19 — well over target; stop introducing new topics, drive to exemplar
 *   20+   — critically over target; one final synthesis prompt then award
 */
function getPacingDirective(exchangeCount) {
  if (exchangeCount >= 20) {
    return (
      'PACING — CRITICAL: This lesson has reached ' + exchangeCount + ' exchanges, nearly twice the target. ' +
      'Do NOT introduce any new topics, examples, or scaffolding. ' +
      'Give the learner one final, direct synthesis prompt that consolidates everything covered. ' +
      'If their response shows any meaningful understanding, award progress 10 immediately. ' +
      'The lesson must conclude on this exchange.'
    );
  }
  if (exchangeCount >= 15) {
    return (
      'PACING — URGENT: This lesson has run ' + exchangeCount + ' exchanges, well past the ' + MAX_EXCHANGES + '-exchange target. ' +
      'Stop all new topic introductions. Do not add examples, analogies, or new scaffolding. ' +
      'Focus exclusively on moving the learner to exemplar quality on their weakest remaining objective. ' +
      'If they are close to meeting the exemplar criteria, award progress 10 now.'
    );
  }
  if (exchangeCount >= MAX_EXCHANGES) {
    return (
      'PACING — WRAP UP NOW: This lesson is at the ' + MAX_EXCHANGES + '-exchange target. ' +
      'Do not introduce new topics or extend the conversation. ' +
      'Give one focused prompt targeting the learner\'s single weakest objective. ' +
      'If their current response meets or nearly meets the exemplar criteria, award progress 10. ' +
      'Prioritize closure over perfect mastery.'
    );
  }
  if (exchangeCount >= 8) {
    return (
      'PACING: This lesson is approaching the ' + MAX_EXCHANGES + '-exchange target (' + exchangeCount + ' exchanges used). ' +
      'Begin moving toward conclusion. Do not introduce new topics. ' +
      'Focus on the learner\'s weakest remaining objective and help them reach exemplar quality. ' +
      'Plan to award progress within the next 2–3 exchanges.'
    );
  }
  return null;
}

/**
 * Returns the post-completion directive — suppresses all coaching after the
 * lesson is marked complete so feedback exchanges don't re-trigger completion
 * side-effects or award progress for a different lesson.
 */
const POST_COMPLETION_DIRECTIVE =
  'This lesson is already COMPLETED. The learner is in feedback mode. ' +
  'Do NOT coach, assess, or award progress (do not emit [PROGRESS] tags). ' +
  'Do NOT start or evaluate a different lesson. ' +
  'Respond warmly to reflections and questions about what was learned, then gently close the conversation.';

// -- Context builder ----------------------------------------------------------

/**
 * Build the context JSON injected as the first user message in every coach
 * call. This is the single place where lesson state, learner profile, pacing
 * signals, and course metadata are assembled for the coach.
 */
export function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const exchangeCount = lessonKB.activitiesCompleted ?? 0;
  const isCompleted = lessonKB.status === 'completed';

  const pacingDirective = isCompleted
    ? POST_COMPLETION_DIRECTIVE
    : getPacingDirective(exchangeCount);

  const ctx = {
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    ...(lesson.course ? { course: { name: lesson.course.name } } : {}),
    lessonKB,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    ...(learnerName ? { learnerName } : {}),
    exchangeCount,
    ...(pacingDirective ? { pacingDirective } : {}),
  };

  return JSON.stringify(ctx);
}

// -- Lesson lifecycle ---------------------------------------------------------

/**
 * Start a new lesson: Lesson Owner generates KB, Coach opens conversation.
 */
export async function startLesson(lessonId, lesson, onStream) {
  assertNotImpersonating('start a lesson');
  await ensureProfileExists();
  const profileSummary = await getLearnerProfileSummary();

  // Lesson Owner generates the KB
  const lessonKB = await orchestrator.initializeLessonKB(lesson, profileSummary);
  lessonKB.lessonId = lessonId;
  lessonKB.name = lesson.name;
  lessonKB.progress = 0;
  lessonKB.startedAt = ts();
  await saveLessonKB(lessonId, lessonKB);
  syncInBackground(`lessonKB:${lessonId}`);

  // Coach opens the conversation
  const prefs = await getPreferences();
  const context = buildContext(lesson, lessonKB, profileSummary, prefs.name);
  const coachMsg = await orchestrator.converseStream(
    'coach',
    [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: 'Start the lesson.' }],
    cleanStream(onStream),
    1024
  );

  const { text, progress } = parseCoachResponse(coachMsg);

  if (progress != null) {
    lessonKB.progress = progress;
    await saveLessonKB(lessonId, lessonKB);
  }

  const messages = [
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: LESSON_PHASES.LEARNING, timestamp: ts() },
  ];

  await saveLessonMessages(lessonId, messages);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);
  return { messages, lessonKB, phase: LESSON_PHASES.LEARNING };
}

/**
 * Send a message in the lesson conversation.
 */
export async function sendMessage(lessonId, lesson, text, imageDataUrl, onStream) {
  assertNotImpersonating('send a message');
  let lessonKB = await getLessonKB(lessonId);
  const profileSummary = await getLearnerProfileSummary();

  assertImageWithinBedrockLimit(imageDataUrl);

  // Save image if provided
  let imageKey = null;
  if (imageDataUrl) {
    imageKey = `lesson-${lessonId}-${ts()}`;
    await saveScreenshot(imageKey, imageDataUrl);
  }

  // Build conversation tail — filter out messages with empty content (e.g. image-only)
  const allMsgs = await getLessonMessages(lessonId);
  const tail = allMsgs.slice(-15)
    .map(m => ({ role: m.role, content: m.content }))
    .filter(m => m.content && (typeof m.content === 'string' ? m.content.trim() : m.content.length));

  // Build user message content
  const userParts = [];
  if (text) userParts.push({ type: 'text', text });
  if (imageDataUrl) {
    const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      userParts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
  }

  // Always include context as first message so coach has lesson + profile info
  const prefs = await getPreferences();
  const contextMsg = buildContext(lesson, lessonKB, profileSummary, prefs.name);
  const messages = [{ role: 'user', content: contextMsg }, { role: 'assistant', content: 'Ready.' }, ...tail];
  messages.push({ role: 'user', content: userParts.length === 1 && !imageDataUrl ? text : userParts });

  const coachMsg = await orchestrator.converseStream(
    'coach',
    messages,
    cleanStream(onStream),
    1024
  );

  const { text: coachText, progress, kbUpdate, profileUpdate } = parseCoachResponse(coachMsg);

  // Apply coach response — updates lessonKB in place, returns completion flag
  const { achieved, lessonKB: updatedKB } = applyCoachResponseToKB(
    lessonKB, progress, kbUpdate, lessonId
  );
  lessonKB = updatedKB;

  await saveLessonKB(lessonId, lessonKB);

  // Incremental profile update in background (non-blocking)
  if (profileUpdate) {
    updateProfileFromObservation(profileUpdate).catch(() => {});
  }

  // Save messages
  const userMsg = {
    role: 'user',
    content: text || '',
    imageKey: imageKey || undefined,
    msgType: MSG_TYPES.USER,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
    timestamp: ts(),
  };
  const assistantMsg = {
    role: 'assistant',
    content: coachText,
    msgType: MSG_TYPES.GUIDE,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
    timestamp: ts(),
  };

  const newMessages = [...allMsgs, userMsg, assistantMsg];
  await saveLessonMessages(lessonId, newMessages);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  if (achieved) {
    updateProfileOnCompletionInBackground(lessonId, lessonKB);
  }

  return {
    messages: newMessages,
    lessonKB,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
    achieved,
  };
}

/**
 * Pure helper — applies a coach response (progress + KB update) to the current
 * lessonKB, returning the updated KB and whether this exchange achieved completion.
 *
 * This is the single owner of the completion invariant:
 *   - progress >= 10 → lesson is complete
 *   - activitiesCompleted only increments while the lesson is in progress
 *   - status transitions from 'in_progress' → 'completed' exactly once
 *   - achieved is true only on the transition turn (one-shot)
 *
 * Post-completion: activitiesCompleted freezes so feedback exchanges don't
 * inflate the extendedLessons KPI or corrupt exchange-count metrics.
 */
export function applyCoachResponseToKB(lessonKB, progress, kbUpdate, lessonId) {
  const wasCompleted = lessonKB.status === 'completed';
  const updated = { ...lessonKB };

  // Increment exchange counter only while lesson is in progress
  if (!wasCompleted) {
    updated.activitiesCompleted = (updated.activitiesCompleted ?? 0) + 1;
  }

  // Apply KB field updates
  if (kbUpdate && typeof kbUpdate === 'object') {
    Object.assign(updated, kbUpdate);
  }

  // Apply progress
  if (progress != null) {
    updated.progress = progress;
  }

  // Check for completion transition
  const achieved = !wasCompleted && (updated.progress ?? 0) >= 10;
  if (achieved) {
    updated.status = 'completed';
    updated.completedAt = ts();
  }

  return { achieved, lessonKB: updated };
}
