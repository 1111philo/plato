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
 * Returns a pacing directive string based on how many exchanges have occurred.
 * Thresholds are set relative to MAX_EXCHANGES (11):
 *   - At target (11+):  begin closing — start wrapping up this exchange
 *   - Over target (15+): hard close — deliver closing summary now, this reply
 *   - Emergency (20+):  emergency close — end immediately regardless of progress
 */
function getPacingDirective(exchangeCount) {
  const hardLimit = MAX_EXCHANGES * 2; // 22
  const emergencyThreshold = Math.round(hardLimit * 0.9); // 20
  const hardCloseThreshold = Math.round(MAX_EXCHANGES * 1.35); // ~15

  if (exchangeCount >= emergencyThreshold) {
    return 'CRITICAL: The lesson has significantly exceeded its target length. You MUST end the lesson immediately in this reply. Deliver a one-sentence affirmation of what the learner accomplished and set [PROGRESS: 10] now, regardless of how far they have come. Do not ask any more questions.';
  }
  if (exchangeCount >= hardCloseThreshold) {
    return 'URGENT: The lesson has run well over its target. In THIS reply you must: (1) stop introducing new content or asking exploratory questions, (2) deliver a brief closing summary of what the learner achieved, and (3) set [PROGRESS: 10] to complete the lesson. This is the final coaching exchange.';
  }
  if (exchangeCount >= MAX_EXCHANGES) {
    return 'The lesson has reached its target length. Begin closing NOW: acknowledge what the learner has done, give a concise wrap-up, and set [PROGRESS: 10] if they have made meaningful progress. Do not open new topics or ask questions that would extend the conversation further.';
  }
  return null;
}

// -- Context builder ----------------------------------------------------------

/**
 * Build the context object passed to the coach as the first user message.
 * Includes lesson info, learner KB, profile summary, and an optional pacing directive.
 */
export function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const exchangeCount = lessonKB.activitiesCompleted || 0;
  const pacingDirective = getPacingDirective(exchangeCount);

  const ctx = {
    lessonId: lesson.lessonId,
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    learnerName: learnerName || 'Learner',
    lessonKB,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
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
  if (parsed.profileUpdate) {
    updateProfileInBackground(parsed.profileUpdate);
  } else if (parsed.kbUpdate?.insights?.length) {
    updateProfileFromObservation(lessonId, lesson.name, parsed.kbUpdate.insights);
  }

  // On completion, trigger deep profile update
  if (achieved && lessonKB.status === 'completed') {
    updateProfileOnCompletionInBackground(lessonId, lesson.name);
  }

  const userMsg = {
    role: 'user',
    content: text || '',
    msgType: MSG_TYPES.USER,
    phase: LESSON_PHASES.LEARNING,
    timestamp: ts(),
    ...(imageKey ? { imageKey } : {}),
  };

  const assistantMsg = {
    role: 'assistant',
    content: parsed.text,
    msgType: MSG_TYPES.GUIDE,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
    timestamp: ts(),
    progress: parsed.progress,
  };

  const newMessages = [userMsg, assistantMsg];
  const updatedMessages = [...allMsgs, ...newMessages];
  await saveLessonMessages(lessonId, updatedMessages);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  return {
    messages: newMessages,
    lessonKB,
    phase: achieved ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING,
    progress: parsed.progress,
  };
}
