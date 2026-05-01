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
    512
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
    512
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
  const userMsg = {
    role: 'user',
    content: text || '',
    imageKey,
    msgType: MSG_TYPES.USER,
    phase: LESSON_PHASES.LEARNING,
    timestamp: ts(),
  };
  const assistantMsg = {
    role: 'assistant',
    content: parsed.text,
    msgType: MSG_TYPES.GUIDE,
    phase,
    timestamp: ts(),
  };

  const newMessages = [userMsg, assistantMsg];
  await saveLessonMessages(lessonId, [...allMsgs, ...newMessages]);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  if (achieved) {
    updateProfileOnCompletionInBackground(lessonId, lessonKB);
  }

  return { messages: newMessages, lessonKB, phase, achieved };
}

/**
 * Pure helper — apply a parsed coach response to a lessonKB snapshot.
 * Returns { lessonKB, achieved, phase }.
 *
 * This is the SINGLE owner of completion semantics:
 * - Only progress >= 10 triggers completion
 * - Post-completion chatter does not increment activitiesCompleted
 * - `achieved` is one-shot (true only on the transition turn)
 */
export function applyCoachResponseToKB(lessonKB, parsed, { now = Date.now } = {}) {
  const wasCompleted = lessonKB.status === 'completed';
  let achieved = false;

  const kb = { ...lessonKB };

  // Apply KB update
  if (parsed.kbUpdate && !wasCompleted) {
    if (parsed.kbUpdate.insights) kb.insights = [...(kb.insights || []), ...parsed.kbUpdate.insights];
    if (parsed.kbUpdate.gaps) kb.gaps = parsed.kbUpdate.gaps;
    if (parsed.kbUpdate.strengths) kb.strengths = parsed.kbUpdate.strengths;
  }

  // Apply progress — only if not already completed
  if (parsed.progress != null && !wasCompleted) {
    kb.progress = parsed.progress;
  }

  // Increment exchange counter on every learning turn
  if (!wasCompleted) {
    kb.activitiesCompleted = (kb.activitiesCompleted || 0) + 1;
  }

  // Check for completion
  if (!wasCompleted && kb.progress >= 10) {
    kb.status = 'completed';
    kb.completedAt = now();
    achieved = true;
  }

  // Post-completion: activitiesCompleted must not increment further
  // (it's the learning-exchange counter, not a total-turn counter)

  const phase = kb.status === 'completed' ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING;

  return { lessonKB: kb, achieved, phase };
}

/**
 * Build the context JSON sent to the coach at the start of every turn.
 * Includes lesson definition, current KB state, learner profile, and
 * a pacingDirective that escalates as exchange count grows.
 */
export function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const exchanges = lessonKB.activitiesCompleted || 0;

  let pacingDirective = null;
  let postCompletionDirective = null;

  if (lessonKB.status === 'completed') {
    // Post-completion: suppress pacing, switch to feedback mode
    pacingDirective = undefined;
    postCompletionDirective =
      'This lesson is complete. You are now in feedback-only mode. ' +
      'Do NOT coach, assess, or award progress for any lesson. ' +
      'Respond warmly to the learner\'s reflection or questions about what they just learned. ' +
      'If the learner wishes to work on a new topic, start the next lesson separately.';
  } else if (exchanges >= 20) {
    pacingDirective =
      'CRITICAL — this lesson has reached 20+ exchanges. You MUST bring it to completion RIGHT NOW. ' +
      'Award [PROGRESS: 10] immediately unless there is a safety or accuracy reason not to. ' +
      'Do not introduce any new topics, questions, or scaffolding.';
  } else if (exchanges >= 15) {
    pacingDirective =
      'URGENT — this lesson is at ' + exchanges + ' exchanges, well past the 11-exchange target. ' +
      'Wrap up now. Deliver a brief, affirming closing statement and award [PROGRESS: 10] if the learner ' +
      'has shown any reasonable engagement with the core concept. Do not ask any more questions. ' +
      'Do not introduce new material.';
  } else if (exchanges >= 11) {
    pacingDirective =
      'This lesson has reached ' + exchanges + ' exchanges — it is over the 11-exchange target. ' +
      'You must move decisively toward closure. In this response or the next, synthesize what the ' +
      'learner has demonstrated, affirm their progress, and award [PROGRESS: 10] if they are ' +
      'reasonably close to the exemplar. Stop introducing new angles or follow-up questions.';
  } else if (exchanges >= 8) {
    pacingDirective =
      'This lesson is at ' + exchanges + ' of 11 target exchanges. Begin steering toward a natural ' +
      'close — consolidate the key insight and avoid opening new threads.';
  }

  const context = {
    lesson: {
      lessonId: lesson.lessonId,
      name: lesson.name,
      description: lesson.description,
      exemplar: lesson.exemplar,
      learningObjectives: lesson.learningObjectives,
    },
    lessonKB,
    lessonStatus: lessonKB.status === 'completed' ? 'completed' : 'active',
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    learnerName: learnerName || null,
    ...(pacingDirective ? { pacingDirective } : {}),
    ...(postCompletionDirective ? { postCompletionDirective } : {}),
  };

  return JSON.stringify(context);
}

/**
 * Post-completion feedback: send a message after the lesson is done.
 * activitiesCompleted is frozen; postCompletionDirective replaces pacingDirective.
 */
export async function sendFeedback(lessonId, lesson, text, onStream) {
  const lessonKB = await getLessonKB(lessonId);
  const profileSummary = await getLearnerProfileSummary();

  const allMsgs = await getLessonMessages(lessonId);
  const tail = allMsgs.slice(-10)
    .map(m => ({ role: m.role, content: m.content }))
    .filter(m => m.content && (typeof m.content === 'string' ? m.content.trim() : true));

  const prefs = await getPreferences();

  // Build post-completion context — pacing suppressed, feedback mode active
  const context = {
    lesson: {
      lessonId: lesson.lessonId,
      name: lesson.name,
      description: lesson.description,
      exemplar: lesson.exemplar,
      learningObjectives: lesson.learningObjectives,
    },
    lessonKB,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    learnerName: prefs.name || null,
    postCompletionDirective:
      'This lesson is complete. You are now in feedback-only mode. ' +
      'Do NOT coach, assess, or award progress for any lesson. ' +
      'Respond warmly to the learner\'s reflection or questions about what they just learned.',
  };

  const messages = [
    { role: 'user', content: JSON.stringify(context) },
    { role: 'assistant', content: 'Ready.' },
    ...tail,
    { role: 'user', content: text },
  ];

  const coachMsg = await orchestrator.converseStream(
    'coach',
    messages,
    cleanStream(onStream),
    512
  );

  const parsed = parseCoachResponse(coachMsg);

  // Profile update from feedback reflection
  if (parsed.profileUpdate?.observation) {
    updateProfileFromObservation(lessonKB, parsed.profileUpdate.observation);
  }

  const userMsg = {
    role: 'user',
    content: text,
    msgType: MSG_TYPES.USER,
    phase: LESSON_PHASES.COMPLETED,
    timestamp: ts(),
  };
  const assistantMsg = {
    role: 'assistant',
    content: parsed.text,
    msgType: MSG_TYPES.GUIDE,
    phase: LESSON_PHASES.COMPLETED,
    timestamp: ts(),
  };

  const newMessages = [userMsg, assistantMsg];
  await saveLessonMessages(lessonId, [...allMsgs, ...newMessages]);
  syncInBackground(`messages:${lessonId}`);

  return { messages: newMessages, lessonKB, phase: LESSON_PHASES.COMPLETED, achieved: false };
}
