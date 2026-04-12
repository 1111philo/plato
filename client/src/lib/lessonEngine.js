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
 * Returns a pacing directive string based on how many exchanges have occurred.
 * Thresholds:
 *   8+  — approaching: steer toward exemplar in the next few exchanges
 *   11+ — urgent: wrap up now, aim for exemplar this exchange
 *   15+ — critical: must reach exemplar immediately
 *   20+ — final: this is the last exchange
 */
function getPacingDirective(activitiesCompleted) {
  const hardLimit = MAX_EXCHANGES * 2; // 22
  if (activitiesCompleted >= hardLimit - 2) {
    return 'FINAL WARNING: This is the last exchange. You MUST bring the lesson to a close and award exemplar status if the learner has demonstrated sufficient understanding. Do not ask any more questions.';
  }
  if (activitiesCompleted >= MAX_EXCHANGES + 4) { // 15+
    return 'CRITICAL: The lesson has significantly exceeded the target length. Bring it to a close immediately. Award exemplar if the learner has shown reasonable understanding — do not require perfection.';
  }
  if (activitiesCompleted >= MAX_EXCHANGES) { // 11+
    return 'URGENT: The lesson has reached its target exchange count. You must wrap up now. Deliver a concise final coaching point and award exemplar if the learner is close to the standard.';
  }
  if (activitiesCompleted >= MAX_EXCHANGES - 3) { // 8+
    return 'APPROACHING LIMIT: The lesson is nearing its target length. Begin steering toward the exemplar now. Focus only on the most important remaining gap, and prepare to close the lesson within the next 2-3 exchanges.';
  }
  return null;
}

// -- Context builder ----------------------------------------------------------

function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const activitiesCompleted = lessonKB.activitiesCompleted || 0;
  const pacingDirective = getPacingDirective(activitiesCompleted);

  const ctx = {
    lessonId: lesson.lessonId,
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    learnerName: learnerName || 'Learner',
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    lessonKB,
    exchangeCount: activitiesCompleted,
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

  const updatedMessages = [...allMsgs, ...newMessages];
  await saveLessonMessages(lessonId, updatedMessages);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  return {
    messages: newMessages,
    lessonKB,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
  };
}
