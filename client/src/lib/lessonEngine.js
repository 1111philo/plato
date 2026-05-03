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

// Bedrock hard limit for base64-encoded image payloads.
// 5 MB decoded = 5 * 1024 * 1024 bytes. Base64 string length * 3/4 ≈ decoded bytes.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Maximum output tokens for coach streaming responses.
// Must be large enough to fit the visible coaching text AND all structured tags
// ([PROGRESS:], [KB_UPDATE:], [PROFILE_UPDATE:]) in a single response.
// 512 was too small — coaches were cutting off mid-response on complex lessons.
const COACH_MAX_TOKENS = 1024;

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

// -- Lesson lifecycle ---------------------------------------------------------

/**
 * Start a new lesson: Lesson Owner generates KB, Coach opens conversation.
 */
export async function startLesson(lessonId, lesson, onStream) {
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
    COACH_MAX_TOKENS
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
    COACH_MAX_TOKENS
  );

  const parsed = parseCoachResponse(coachMsg);

  const applied = applyCoachResponseToKB(lessonKB, parsed, { now: ts });
  lessonKB = applied.lessonKB;
  const { achieved, phase } = applied;

  await saveLessonKB(lessonId, lessonKB);
  syncInBackground(`lessonKB:${lessonId}`);

  // Profile updates — from explicit tag or from KB insights as fallback
  if (parsed.profileUpdate?.observation) {
    updateProfileFromObservation(lessonKB, parsed.profileUpdate.observation);
  } else if (parsed.kbUpdate?.insights?.length) {
    // Use KB insights as a profile signal if no explicit profile update
    const insightText = parsed.kbUpdate.insights.join(' ');
    updateProfileFromObservation(lessonKB, insightText);
  }

  // Save messages
  const newMessages = [
    { role: 'user', content: text || '[image]', msgType: MSG_TYPES.USER, phase: LESSON_PHASES.LEARNING, timestamp: ts(), imageKey },
    { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase, timestamp: ts() },
  ];

  const updatedMessages = [...allMsgs, ...newMessages];
  await saveLessonMessages(lessonId, updatedMessages);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  if (achieved) {
    updateProfileOnCompletionInBackground(lessonId);
  }

  return { messages: updatedMessages, lessonKB, phase, achieved };
}

/**
 * Pure helper — apply a parsed coach response to the lesson KB.
 * Returns { lessonKB, achieved, phase }.
 *
 * This is the single owner of completion semantics:
 * - achieved is true ONLY on the turn where progress first reaches 10
 * - post-completion turns never re-trigger achieved
 * - activitiesCompleted is frozen after completion (post-completion feedback
 *   exchanges must not increment it, or extendedLessons KPI would be corrupted)
 */
export function applyCoachResponseToKB(lessonKB, parsed, { now = Date.now } = {}) {
  const kb = { ...lessonKB };

  // Apply KB update
  if (parsed.kbUpdate) {
    if (parsed.kbUpdate.currentUnderstanding != null) kb.currentUnderstanding = parsed.kbUpdate.currentUnderstanding;
    if (parsed.kbUpdate.insights?.length) kb.insights = [...(kb.insights || []), ...parsed.kbUpdate.insights];
    if (parsed.kbUpdate.misconceptions?.length) kb.misconceptions = [...(kb.misconceptions || []), ...parsed.kbUpdate.misconceptions];
    if (parsed.kbUpdate.nextFocus != null) kb.nextFocus = parsed.kbUpdate.nextFocus;
  }

  const alreadyCompleted = kb.status === 'completed';

  // Update progress — but freeze activitiesCompleted after completion
  if (parsed.progress != null && !alreadyCompleted) {
    kb.progress = parsed.progress;
    kb.activitiesCompleted = (kb.activitiesCompleted || 0) + 1;
  }

  // Check for completion
  const achieved = !alreadyCompleted && kb.progress >= 10;
  if (achieved) {
    kb.status = 'completed';
    kb.completedAt = now();
  }

  const phase = (kb.status === 'completed') ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING;

  return { lessonKB: kb, achieved, phase };
}

// -- Context builder ----------------------------------------------------------

/**
 * Build the context JSON passed as the first user message to the coach.
 * Includes lesson details, current KB state, learner profile, and pacing directive.
 */
export function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const exchanges = lessonKB.activitiesCompleted || 0;
  const isCompleted = lessonKB.status === 'completed';

  let pacingDirective;
  if (isCompleted) {
    pacingDirective = null; // suppressed — postCompletionDirective takes over
  } else if (exchanges >= 20) {
    pacingDirective = 'CRITICAL: This lesson has run very long. The learner needs to reach the exemplar THIS exchange if at all possible. Provide the most direct, targeted feedback you can.';
  } else if (exchanges >= 15) {
    pacingDirective = 'URGENT: This lesson is running significantly over target. Push hard toward the exemplar — be direct and specific about exactly what is missing.';
  } else if (exchanges >= 11) {
    pacingDirective = 'This lesson has exceeded the exchange target. Be more direct and focused — help the learner close the gap to the exemplar quickly.';
  } else if (exchanges >= 8) {
    pacingDirective = 'You are approaching the exchange target. Begin guiding the learner toward synthesis and completion.';
  } else {
    pacingDirective = null;
  }

  const postCompletionDirective = isCompleted
    ? 'This lesson is complete. You are now in feedback-only mode. Do NOT coach, assess, or award progress for any other lesson inside this thread. Only discuss this completed lesson.'
    : null;

  return JSON.stringify({
    lessonId: lesson.lessonId,
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    lessonKB,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    learnerName: learnerName || null,
    exchangeCount: exchanges,
    ...(pacingDirective ? { pacingDirective } : {}),
    ...(postCompletionDirective ? { postCompletionDirective } : {}),
  });
}
