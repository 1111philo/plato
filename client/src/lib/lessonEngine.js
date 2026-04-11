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

// Thresholds are relative to MAX_EXCHANGES so they stay correct if the
// target ever changes.  The first nudge fires 2 exchanges *before* the
// target so the coach has a runway to wrap up within the target window.
//
//   exchanges < TARGET-2          → no directive
//   TARGET-2 <= exchanges < TARGET+2  → gentle wrap-up nudge
//   TARGET+2 <= exchanges < TARGET+9  → stronger close directive
//   exchanges >= TARGET+9         → urgent, lesson must end now
//
const PACING_TIER_1 = MAX_EXCHANGES - 2;   //  9  — start wrapping up
const PACING_TIER_2 = MAX_EXCHANGES + 2;   // 13  — stronger push
const PACING_TIER_3 = MAX_EXCHANGES + 9;   // 20  — urgent close

function getPacingDirective(exchanges) {
  if (exchanges >= PACING_TIER_3) {
    return 'URGENT: This lesson has greatly exceeded the target length. You MUST close the lesson in this exchange — summarise key takeaways and end immediately, regardless of progress.';
  }
  if (exchanges >= PACING_TIER_2) {
    return 'This lesson is running significantly over target. Prioritise closing: consolidate learning, issue a final challenge if needed, and aim to reach the exemplar or wrap up within 1-2 exchanges.';
  }
  if (exchanges >= PACING_TIER_1) {
    return 'The lesson is approaching its target length. Begin steering toward closure: summarise progress, focus on the core exemplar, and avoid introducing new topics.';
  }
  return null;
}

// -- Context builder ----------------------------------------------------------

function buildContext(lesson, lessonKB, profileSummary, learnerName, exchanges) {
  const parts = {
    lessonId: lesson.lessonId,
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    learnerName: learnerName || 'Learner',
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    lessonKB,
    exchangeCount: exchanges ?? 0,
    targetExchanges: MAX_EXCHANGES,
  };
  const directive = getPacingDirective(exchanges ?? 0);
  if (directive) parts.pacingDirective = directive;
  return JSON.stringify(parts);
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
  const context = buildContext(lesson, lessonKB, profileSummary, prefs.name, 0);
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

  // Count exchanges so far (each assistant message = 1 exchange)
  const exchanges = allMsgs.filter(m => m.role === 'assistant').length;

  // Always include context as first message so coach has lesson + profile info
  const prefs = await getPreferences();
  const contextMsg = buildContext(lesson, lessonKB, profileSummary, prefs.name, exchanges);
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
