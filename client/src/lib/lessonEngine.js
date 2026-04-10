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
import { ensureProfileExists, updateProfileInBackground, updateProfileOnCompletionInBackground, updateProfileFromObservation } from './profileQueue.js';
import { LESSON_PHASES, MSG_TYPES, MAX_EXCHANGES } from './constants.js';

function ts() { return Date.now(); }

// -- Tag parsing --------------------------------------------------------------

const PROGRESS_REGEX = /\[PROGRESS:\s*(\d+)\]\s*/g;
const KB_UPDATE_REGEX = /\[KB_UPDATE:\s*(\{[\s\S]*?\})\]\s*/g;
const PROFILE_UPDATE_REGEX = /\[PROFILE_UPDATE:\s*(\{[\s\S]*?\})\]\s*/g;

export function parseCoachResponse(raw) {
  let progress = null;
  let kbUpdate = null;
  let profileUpdate = null;

  // Extract progress
  const progressMatch = raw.match(/\[PROGRESS:\s*(\d+)\]/);
  if (progressMatch) progress = parseInt(progressMatch[1], 10);

  // Extract KB update
  const kbMatch = raw.match(/\[KB_UPDATE:\s*(\{[\s\S]*?\})\]/);
  if (kbMatch) {
    try { kbUpdate = JSON.parse(kbMatch[1]); } catch { /* ignore */ }
  }

  // Extract profile update
  const profileMatch = raw.match(/\[PROFILE_UPDATE:\s*(\{[\s\S]*?\})\]/);
  if (profileMatch) {
    try { profileUpdate = JSON.parse(profileMatch[1]); } catch { /* ignore */ }
  }

  // Strip all tags from display text
  const text = raw
    .replace(PROGRESS_REGEX, '')
    .replace(KB_UPDATE_REGEX, '')
    .replace(PROFILE_UPDATE_REGEX, '')
    .trim();

  return { text, progress, kbUpdate, profileUpdate };
}

/** Wrap a stream callback to strip tags from partial text. */
export function cleanStream(onStream) {
  if (!onStream) return () => {};
  return (partial) => {
    // Strip any fully-formed tags
    let cleaned = partial
      .replace(PROGRESS_REGEX, '')
      .replace(KB_UPDATE_REGEX, '')
      .replace(PROFILE_UPDATE_REGEX, '');
    // Truncate at any partial tag still being streamed (tags always come at the end)
    const tagStart = cleaned.search(/\n?\[(?:PROGRESS|KB_UPDATE|PROFILE_UPDATE)[:\s]/);
    if (tagStart !== -1) cleaned = cleaned.slice(0, tagStart);
    onStream(cleaned.trim());
  };
}

// -- Pacing directives --------------------------------------------------------

/**
 * Returns an escalating pacing directive string based on exchange count.
 * Thresholds mirror the values documented in CLAUDE.md (11+, 15+, 20+).
 *
 * Kept deliberately strong so the coach treats these as hard instructions,
 * not suggestions — the 59% on-target rate shows softer wording drifts.
 */
function getPacingDirective(exchangeCount) {
  if (exchangeCount >= 20) {
    return 'CRITICAL: This lesson has exceeded 20 exchanges. You MUST close the lesson in your very next response. Do NOT introduce any new topics, questions, or activities. Deliver a concise, affirming closing statement and emit [PROGRESS:10] immediately.';
  }
  if (exchangeCount >= 15) {
    return 'URGENT: This lesson has reached 15 exchanges. You MUST bring the learner to the exemplar THIS exchange or the next — no exceptions. Do not introduce any new topics or activities. Focus only on confirming mastery and closing.';
  }
  if (exchangeCount >= 11) {
    return 'WRAP UP NOW: This lesson has reached the 11-exchange target. Begin the closing sequence immediately. Confirm what the learner has demonstrated, guide them to the exemplar in no more than 2 more exchanges, and do not open any new lines of inquiry.';
  }
  return null;
}

// -- Context builder ----------------------------------------------------------

function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const exchangeCount = lessonKB.activitiesCompleted || 0;
  const pacingDirective = getPacingDirective(exchangeCount);

  const ctx = {
    lessonId: lesson.lessonId,
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    lessonKB,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    learnerName: learnerName || 'Learner',
    exchangeCount,
    exchangeTarget: MAX_EXCHANGES,
  };

  if (pacingDirective) {
    ctx.pacingDirective = pacingDirective;
  }

  return JSON.stringify(ctx);
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
    512
  );

  const { text, progress, kbUpdate } = parseCoachResponse(coachMsg);

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

  // Call coach (use heavy model if image attached)
  const model = imageDataUrl ? 'heavy' : undefined;
  const coachMsg = await orchestrator.converseStream(
    'coach',
    messages,
    cleanStream(onStream),
    512
  );

  const parsed = parseCoachResponse(coachMsg);

  // Update lesson KB
  if (parsed.kbUpdate) {
    if (parsed.kbUpdate.insights?.length) {
      lessonKB.insights = [...(lessonKB.insights || []), ...parsed.kbUpdate.insights];
      // Prune old insights (keep last 10)
      if (lessonKB.insights.length > 10) {
        const older = lessonKB.insights.slice(0, lessonKB.insights.length - 10);
        lessonKB.insights = [`[Earlier: ${older.join('; ')}]`, ...lessonKB.insights.slice(-10)];
      }
    }
    if (parsed.kbUpdate.learnerPosition) {
      lessonKB.learnerPosition = parsed.kbUpdate.learnerPosition;
    }
  }
  if (parsed.progress != null) {
    lessonKB.progress = parsed.progress;
  }
  lessonKB.activitiesCompleted = (lessonKB.activitiesCompleted || 0) + 1;

  // Check completion — the learner achieves the exemplar (progress 10),
  // or the system gracefully closes the lesson at 2x the exchange target
  // as a safety net (the coach is instructed to wrap up well before this).
  const hardLimit = MAX_EXCHANGES * 2;
  const achieved = parsed.progress >= 10 || lessonKB.activitiesCompleted >= hardLimit;
  if (achieved && lessonKB.status !== 'completed') {
    lessonKB.status = 'completed';
    lessonKB.completedAt = ts();
  }

  await saveLessonKB(lessonId, lessonKB);
  syncInBackground(`lessonKB:${lessonId}`);

  // Profile updates — from explicit tag or from KB insights as fallback
  if (parsed.profileUpdate?.observation) {
    updateProfileFromObservation(lessonKB, parsed.profileUpdate.observation);
  } else if (parsed.kbUpdate?.insights?.length) {
    // Use KB insights as a profile signal if no explicit profile update
    const insightText = parsed.kbUpdate.insights.join('. ');
    updateProfileFromObservation(lessonKB, insightText);
  }
  if (achieved) {
    updateProfileOnCompletionInBackground(lessonKB, lesson);
  }

  // Save messages
  const newMessages = [
    { role: 'user', content: text || (imageKey ? '[image]' : ''), msgType: MSG_TYPES.USER, phase: LESSON_PHASES.LEARNING,
      metadata: imageKey ? { imageKey } : null, timestamp: ts() },
    { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING, timestamp: ts() },
  ];

  const saved = await getLessonMessages(lessonId);
  await saveLessonMessages(lessonId, [...saved, ...newMessages]);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  return {
    messages: newMessages,
    lessonKB,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
  };
}
