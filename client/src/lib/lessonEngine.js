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
    { role: 'user', content: text || (imageKey ? '[image]' : ''), msgType: MSG_TYPES.USER, phase,
      metadata: imageKey ? { imageKey } : null, timestamp: ts() },
    { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase, timestamp: ts() },
  ];

  await saveLessonMessages(lessonId, newMessages);
  syncInBackground(`messages:${lessonId}`);

  return { messages: newMessages, progress: parsed.progress, achieved, phase };
}

/**
 * Resume an existing lesson. Loads messages and KB.
 */
export async function resumeLesson(lessonId) {
  const messages = await getLessonMessages(lessonId);
  const lessonKB = await getLessonKB(lessonId);
  const progress = lessonKB?.progress ?? 0;
  const phase = lessonKB?.status === 'completed' ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING;
  return { messages, lessonKB, progress, phase };
}

// -- Helpers ------------------------------------------------------------------

/**
 * Apply a parsed coach response to a lesson KB. Pure — returns a new KB
 * without mutating the input. Centralizes the "feedback mode" invariant:
 * once a lesson is completed the exchange counter freezes and `achieved`
 * can't re-fire, so one-shot side effects (confetti, completion profile
 * update) stay one-shot across the feedback conversation that follows.
 */
export function applyCoachResponseToKB(prevKB, parsed, { now = Date.now } = {}) {
  const wasCompleted = prevKB?.status === 'completed';
  const next = { ...prevKB };

  if (parsed.kbUpdate) {
    if (parsed.kbUpdate.insights?.length) {
      next.insights = [...(next.insights || []), ...parsed.kbUpdate.insights];
      // Prune old insights (keep last 10)
      if (next.insights.length > 10) {
        const older = next.insights.slice(0, next.insights.length - 10);
        next.insights = [`[Earlier: ${older.join('; ')}]`, ...next.insights.slice(-10)];
      }
    }
    if (parsed.kbUpdate.learnerPosition) {
      next.learnerPosition = parsed.kbUpdate.learnerPosition;
    }
  }
  if (parsed.progress != null) {
    next.progress = parsed.progress;
  }
  if (!wasCompleted) {
    next.activitiesCompleted = (next.activitiesCompleted || 0) + 1;
  }

  // `achieved` means "just achieved on this turn" — one-shot. Without this
  // guard it would re-fire on every post-completion message, triggering
  // confetti + completion-profile updates repeatedly in the feedback thread.
  const achieved = parsed.progress >= 10 && !wasCompleted;
  if (achieved) {
    next.status = 'completed';
    next.completedAt = now();
  }
  const phase = next.status === 'completed' ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING;
  return { lessonKB: next, achieved, phase };
}

export function buildContext(lesson, lessonKB, profileSummary, learnerName) {
  const completed = lessonKB?.activitiesCompleted || 0;
  const lessonStatus = lessonKB?.status === 'completed' ? 'completed' : 'active';
  const context = {
    learnerName: learnerName || '',
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    exemplar: lesson.exemplar,
    lessonStatus,
    objectives: lessonKB?.objectives || [],
    insights: lessonKB?.insights || [],
    learnerProfile: profileSummary || 'No profile yet',
    learnerPosition: lessonKB?.learnerPosition || 'New learner',
    progress: lessonKB?.progress ?? 0,
    activitiesCompleted: completed,
  };
  if (lessonStatus === 'completed') {
    // Completed threads are feedback-only. Skip pacing nudges — they'd
    // conflict with the feedback directive — and tell the coach plainly not
    // to treat this thread as a new lesson.
    context.postCompletionDirective = 'This lesson is already complete. Stay in feedback mode only. Do not coach, assess, or award credit for another lesson in this conversation. If the learner wants to continue with a new lesson, tell them to start the next lesson separately so their work is tracked there.';
    return JSON.stringify(context);
  }
  // Pacing directives are nudges, not orders. The target (MAX_EXCHANGES) is a
  // design goal for ~20-minute lessons — never a deadline. The coach always
  // decides when the learner has demonstrated the exemplar. These messages
  // help the coach sharpen its focus as exchanges accumulate, but NEVER tell
  // it to force-close a lesson on the learner.
  const over = completed - MAX_EXCHANGES;
  if (over >= 9) {
    // 20+ exchanges: the lesson has run well past the target. Likely a sign
    // the lesson design or the learner's starting point mismatched — worth
    // a reflective note, but still the coach's call to close.
    context.pacingDirective = 'This lesson has run well past its target length. If the learner has demonstrated the exemplar (or something close to it), this is a good moment to award progress 10 and close warmly. If they are still genuinely working toward it, keep moving them forward — prefer smaller, more concrete steps. Note in [KB_UPDATE] if the lesson design seems to be the issue.';
  } else if (over >= 4) {
    // 15+ exchanges: converge hard. Prefer closing when the exemplar is met,
    // but do not force the issue if the learner is still making progress.
    context.pacingDirective = 'The lesson has run longer than target. Compress: focus on the single biggest remaining gap. If the learner has demonstrated the exemplar, award progress 10 and close warmly. If they are close, one sharp final step can get them there. Keep moving them forward — never cut them off mid-thought.';
  } else if (over >= 0) {
    // 11+ exchanges: target reached. Start to converge.
    context.pacingDirective = 'Target exchange count reached. Begin converging toward the exemplar — avoid introducing new objectives. If the learner has demonstrated the exemplar, award progress 10. Otherwise give one focused nudge that narrows the gap.';
  } else if (completed >= MAX_EXCHANGES - 3) {
    // 8-10 exchanges: pre-target — start converging.
    const remaining = MAX_EXCHANGES - completed;
    context.pacingDirective = `Approaching target (${remaining} exchange${remaining === 1 ? '' : 's'} until the ~20-minute design goal). Converge toward the exemplar — one focused task that narrows the gap. You may still introduce new concepts if the learner genuinely needs them to advance.`;
  }
  return JSON.stringify(context);
}
