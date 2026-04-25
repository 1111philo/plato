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
 * Build the opening instruction for the coach's first message.
 * Tells the coach to orient the learner to the lesson objectives and
 * the exemplar (final project) before beginning the first activity.
 * This reduces aimless early exchanges and improves on-target completion rates.
 */
function buildStartInstruction(lesson) {
  const objectives = (lesson.learningObjectives || []).join('; ');
  const exemplar = lesson.exemplar || '';

  let instruction = 'Start the lesson.';

  if (objectives || exemplar) {
    instruction =
      'Start the lesson. ' +
      'Your opening message must first give the learner a brief orientation: ' +
      (objectives
        ? `(1) state the learning objectives they will achieve (${objectives})`
        : '(1) state what they will learn') +
      (exemplar
        ? ` and (2) describe the final project or exemplar they will create by the end (${exemplar}).`
        : ' and (2) describe what they will produce by the end.') +
      ' Keep this orientation concise (2-3 sentences), then immediately begin the first activity.';
  }

  return instruction;
}

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
  const startInstruction = buildStartInstruction(lesson);
  const coachMsg = await orchestrator.converseStream(
    'coach',
    [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: startInstruction }],
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

  // Call coach (use heavy model if image attached)
  const model = imageDataUrl ? 'heavy' : undefined;
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
  } else if (parsed.kbUpdate?.insights) {
    updateProfileInBackground(lessonKB);
  }

  // Build new assistant message
  const assistantMsg = {
    role: 'assistant',
    content: parsed.text,
    msgType: MSG_TYPES.GUIDE,
    phase,
    timestamp: ts(),
  };

  // Save user + assistant messages
  const userMsg = {
    role: 'user',
    content: text || '',
    imageKey,
    msgType: MSG_TYPES.USER,
    phase,
    timestamp: ts(),
  };

  await saveLessonMessages(lessonId, [userMsg, assistantMsg]);
  syncInBackground(`lessonKB:${lessonId}`, `messages:${lessonId}`);

  if (achieved) {
    updateProfileOnCompletionInBackground(lessonKB, lessonId);
  }

  return { messages: [userMsg, assistantMsg], lessonKB, phase, achieved };
}

/**
 * Apply a parsed coach response to the lesson KB.
 * Pure function — no side effects, no storage calls.
 *
 * Handles the post-completion invariant: once status === 'completed',
 * activitiesCompleted is frozen and progress cannot regress.
 */
export function applyCoachResponseToKB(lessonKB, parsed, { now = Date.now } = {}) {
  const kb = { ...lessonKB };
  let achieved = false;

  const alreadyCompleted = kb.status === 'completed';

  // Update KB fields from structured tag
  if (parsed.kbUpdate && !alreadyCompleted) {
    if (parsed.kbUpdate.currentFocus !== undefined) kb.currentFocus = parsed.kbUpdate.currentFocus;
    if (parsed.kbUpdate.insights) {
      kb.insights = [...(kb.insights || []), ...parsed.kbUpdate.insights];
    }
    if (parsed.kbUpdate.activitiesCompleted !== undefined) {
      kb.activitiesCompleted = parsed.kbUpdate.activitiesCompleted;
    }
  }

  // Progress update
  if (parsed.progress != null && !alreadyCompleted) {
    kb.progress = parsed.progress;
  }

  // Completion check — only progress >= 10 triggers completion
  if (!alreadyCompleted && kb.progress >= 10) {
    kb.status = 'completed';
    kb.completedAt = now();
    achieved = true;
  }

  const phase = kb.status === 'completed' ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING;

  return { lessonKB: kb, achieved, phase };
}

/**
 * Build the context JSON string passed as the first user message to the coach.
 * Includes lesson definition, current KB state, learner profile, and pacing directive.
 */
export function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const exchanges = lessonKB.activitiesCompleted || 0;

  let pacingDirective = null;
  let postCompletionDirective = null;

  if (lessonKB.status === 'completed') {
    postCompletionDirective =
      'This lesson is complete. The learner is in feedback/reflection mode. ' +
      'Do NOT coach, assess, assign new activities, or award progress for any other lesson. ' +
      'Respond warmly to reflections or questions about this lesson only.';
  } else {
    if (exchanges >= 20) {
      pacingDirective =
        'CRITICAL: This lesson has run very long. You must wrap up immediately. ' +
        'If the learner has shown reasonable effort, award progress 10 now.';
    } else if (exchanges >= 15) {
      pacingDirective =
        'URGENT: Lesson is significantly over target. Consolidate remaining objectives ' +
        'into the current activity and move toward awarding progress 10.';
    } else if (exchanges >= 11) {
      pacingDirective =
        'NOTE: Lesson has exceeded the target length. Begin wrapping up — ' +
        'prioritize the exemplar completion over introducing new material.';
    } else if (exchanges >= 8) {
      pacingDirective =
        'NOTE: Approaching the end of the target lesson length. ' +
        'Focus remaining exchanges on completing the exemplar.';
    }
  }

  const ctx = {
    lessonId: lesson.lessonId,
    lessonName: lesson.name,
    learnerName: learnerName || 'Learner',
    learningObjectives: lesson.learningObjectives || [],
    exemplar: lesson.exemplar || '',
    lessonKB,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
    exchangeCount: exchanges,
    exchangeTarget: MAX_EXCHANGES,
    ...(pacingDirective ? { pacingDirective } : {}),
    ...(postCompletionDirective ? { postCompletionDirective } : {}),
  };

  return JSON.stringify(ctx);
}
