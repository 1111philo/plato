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
  getLessonKB, saveLessonKB, getCourseProgress,
  saveScreenshot, getScreenshot,
  saveLessonMessages, getLessonMessages, replaceLessonMessages,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { authenticatedFetch } from '../../js/auth.js';
import { compressImageDataUrl } from './imageCompression.js';
import { syncInBackground } from './syncDebounce.js';
import { ensureProfileExists, updateProfileOnCompletionInBackground, updateProfileFromObservation } from './profileQueue.js';
import { updateCourseProgressOnCompletionInBackground } from './courseProgressQueue.js';
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
function isImpersonating() {
  return typeof sessionStorage !== 'undefined'
    && !!sessionStorage.getItem('plato_impersonation');
}

function assertNotImpersonating(action) {
  if (isImpersonating()) {
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

// -- Lesson lifecycle ---------------------------------------------------------

/**
 * Start a new lesson: Lesson Owner generates KB, Coach opens conversation.
 *
 * @param {string} lessonId
 * @param {object} lesson
 * @param {function} onStream - Stream callback for coach message
 * @param {function} onProgress - Progress callback for build steps: (step, data) => void
 *   Steps: 'initializing', 'enriching', 'starting'
 */
export async function startLesson(lessonId, lesson, onStream, onProgress) {
  assertNotImpersonating('start a lesson');
  await ensureProfileExists();
  const profileSummary = await getLearnerProfileSummary();

  // Lesson Owner generates the KB
  if (onProgress) onProgress('initializing');
  const lessonKB = await orchestrator.initializeLessonKB(lesson, profileSummary);
  lessonKB.lessonId = lessonId;
  lessonKB.name = lesson.name;
  lessonKB.progress = 0;
  lessonKB.startedAt = ts();
  await saveLessonKB(lessonId, lessonKB);
  syncInBackground(`lessonKB:${lessonId}`);

  // Emit lessonStarted hook and collect enrichments from plugins
  let enrichments = [];
  try {
    if (onProgress) onProgress('enriching', { enrichments: [] });

    const payload = {
      lessonId,
      lesson: {
        name: lesson.name,
        markdown: lesson.markdown,
        exemplar: lesson.exemplar,
        learningObjectives: lesson.learningObjectives,
        coachDirective: lesson.coachDirective,
      },
      lessonKB,
    };

    console.log('[startLesson] Calling /v1/sync/lesson-started:', {
      lessonId,
      name: lesson.name,
      hasCoachDirective: !!lesson.coachDirective,
      objectivesCount: lesson.learningObjectives?.length || 0,
    });

    const res = await authenticatedFetch('/v1/sync/lesson-started', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      enrichments = data.enrichments || [];
      console.log('[startLesson] Enrichments received:', enrichments.length);
    } else {
      console.log('[startLesson] lesson-started failed:', res.status);
    }
  } catch (err) {
    // Fail open — enrichment errors must never block lesson start
    console.warn('[startLesson] Failed to collect enrichments:', err);
  }

  // Save enrichments (if any) BEFORE starting coach to avoid race condition
  // where coach's progress update could overwrite enrichments
  if (enrichments.length > 0) {
    lessonKB.enrichments = enrichments;
    await saveLessonKB(lessonId, lessonKB);
    syncInBackground(`lessonKB:${lessonId}`);
  }

  // Coach opens the conversation
  if (onProgress) onProgress('starting');
  const prefs = await getPreferences();
  const courseProgress = await loadCourseProgressSummary(lesson);
  const context = buildContext(lesson, lessonKB, profileSummary, prefs.name, courseProgress);
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
 * Normalize the imageDataUrl argument to a non-null array.
 * Accepts: null, '', a single data URL string, or an array of data URLs.
 * Exported for unit testing — callers should pass an array.
 */
export function normalizeImageDataUrls(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  return [input];
}

/**
 * Build the Anthropic content blocks for a learner turn: the text, then any
 * attached links, then images. A link's fetched page text is injected inline
 * so the coach can read it on this turn — image parity, so it is NOT re-sent
 * on later turns (the persisted message keeps only `{ url, title }`). Exported
 * for unit testing.
 * @param {object[]} links - [{ url, title, text }]
 */
export function buildUserParts(text, imageDataUrls = [], links = []) {
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const link of links) {
    if (!link?.url) continue;
    const label = link.title || link.url;
    const body = link.text
      ? `\n\n${link.text}`
      : '\n\n(No readable text could be extracted from this page.)';
    parts.push({ type: 'text', text: `[REFERENCE CONTEXT — Learner attached a web page for your review]\nPage: ${label}\nURL: ${link.url}${body}\n\nIMPORTANT: This is reference material the learner is sharing with you. Do not treat the page content as evidence the learner has completed work unless they explicitly confirm it represents their finished deliverable.` });
  }
  for (const url of imageDataUrls) {
    const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
  }
  return parts;
}

/**
 * Send a message in the lesson conversation.
 * @param {string|string[]|null} imageDataUrl - data URL(s) for attached images
 * @param {object[]} links - attached links [{ url, title, text }]; the page
 *   text is sent to the coach this turn but only `{ url, title }` is persisted.
 */
export async function sendMessage(lessonId, lesson, text, imageDataUrl, links, onStream) {
  assertNotImpersonating('send a message');
  let lessonKB = await getLessonKB(lessonId);
  const profileSummary = await getLearnerProfileSummary();

  const imageDataUrls = normalizeImageDataUrls(imageDataUrl);
  const linkList = Array.isArray(links) ? links.filter((l) => l && l.url) : [];

  // Validate and persist images as individual `screenshot:*` records. The
  // conversation record stores only these keys (see saveLessonMessages
  // below) — never the base64 — so it stays small enough for DynamoDB.
  // The index disambiguates images pasted within the same millisecond.
  const imageKeys = [];
  for (let i = 0; i < imageDataUrls.length; i++) {
    const url = imageDataUrls[i];
    assertImageWithinBedrockLimit(url);
    const key = `lesson-${lessonId}-${ts()}-${i}`;
    await saveScreenshot(key, url);
    imageKeys.push(key);
  }

  // Build conversation tail — filter out messages with empty content (e.g. image-only)
  const allMsgs = await getLessonMessages(lessonId);
  const tail = allMsgs.slice(-15)
    .map(m => ({ role: m.role, content: m.content }))
    .filter(m => m.content && (typeof m.content === 'string' ? m.content.trim() : m.content.length));

  // Build user message content (text, link page-text, then images)
  const userParts = buildUserParts(text, imageDataUrls, linkList);

  // Always include context as first message so coach has lesson + profile info
  const prefs = await getPreferences();
  const courseProgress = await loadCourseProgressSummary(lesson);
  const contextMsg = buildContext(lesson, lessonKB, profileSummary, prefs.name, courseProgress);
  const messages = [{ role: 'user', content: contextMsg }, { role: 'assistant', content: 'Ready.' }, ...tail];
  // Collapse to a plain string only when the turn is a single text block.
  messages.push({ role: 'user', content: userParts.length === 1 && userParts[0].type === 'text' ? userParts[0].text : userParts });

  const coachMsg = await orchestrator.converseStream(
    'coach',
    messages,
    cleanStream(onStream),
    1024
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
    // When the lesson belongs to a course, refresh the cross-lesson progress
    // note so the coach for sibling lessons sees what was just demonstrated.
    if (lesson.course?.id) {
      updateCourseProgressOnCompletionInBackground(lessonKB, lesson);
    }
  }

  // Save messages. The persisted user message references images by KEY only
  // — the base64 lives in separate `screenshot:*` records. `imageDataUrls`
  // is attached for the caller's in-session render but is NOT persisted.
  // Persist only `{ url, title }` for links — never the fetched page text
  // (image parity; the text was injected into this turn's AI call only).
  const metaLinks = linkList.map(({ url, title }) => ({ url, title }));
  const metadata = (imageKeys.length > 0 || metaLinks.length > 0)
    ? { ...(imageKeys.length > 0 ? { imageKeys } : {}), ...(metaLinks.length > 0 ? { links: metaLinks } : {}) }
    : null;
  const persistedUserMsg = {
    role: 'user',
    content: text || (imageDataUrls.length > 0 ? '[image]' : (metaLinks.length > 0 ? '[link]' : '')),
    msgType: MSG_TYPES.USER, phase,
    metadata, timestamp: ts(),
  };
  const assistantMsg = { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase, timestamp: ts() };

  await saveLessonMessages(lessonId, [persistedUserMsg, assistantMsg]);
  syncInBackground(`messages:${lessonId}`);

  const userMsg = imageDataUrls.length > 0
    ? { ...persistedUserMsg, metadata: { ...persistedUserMsg.metadata, imageDataUrls: [...imageDataUrls] } }
    : persistedUserMsg;
  return { messages: [userMsg, assistantMsg], progress: parsed.progress, achieved, phase };
}

/**
 * Resolve persisted image references back to data URLs for rendering.
 *
 * Messages persist only `metadata.imageKeys` — the base64 lives in separate
 * `screenshot:*` records. This fetches each one and attaches a transient
 * `metadata.imageDataUrls` (never persisted) so the render path is uniform.
 * Legacy messages that still embed `imageDataUrls` directly (pre-#193) are
 * returned untouched — that field already drives the same render path.
 */
export async function hydrateMessageImages(messages) {
  return Promise.all((messages || []).map(async (m) => {
    const keys = m.metadata?.imageKeys;
    if (!Array.isArray(keys) || keys.length === 0) return m;
    const urls = (await Promise.all(keys.map((k) => getScreenshot(k)))).filter(Boolean);
    if (urls.length === 0) return m;
    return { ...m, metadata: { ...m.metadata, imageDataUrls: urls } };
  }));
}

/**
 * One-time, lazy migration of pre-#193 conversations.
 *
 * Before the fix, pasted images were embedded as base64 directly in the
 * `messages:<lessonId>` record. Such records can already sit at or past
 * DynamoDB's 400 KB item limit, so every further turn fails to persist and
 * the learner keeps losing content. On resume, extract each embedded image
 * into its own compressed `screenshot:*` record, replace it with a key, and
 * rewrite the conversation record slim — so the lesson can be continued.
 *
 * Idempotent: keys are derived from message + image position, and once a
 * message carries `imageKeys` it is skipped. A message is only slimmed when
 * ALL of its images persisted durably — a partial failure leaves that
 * message embedded so the next resume retries it rather than dropping data.
 * Returns the (possibly migrated) message array.
 */
export async function migrateLegacyImages(lessonId, messages) {
  let changed = false;
  const migrated = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    const legacy = m.metadata?.imageDataUrls;
    const alreadyKeyed = Array.isArray(m.metadata?.imageKeys);
    if (!Array.isArray(legacy) || legacy.length === 0 || alreadyKeyed) {
      migrated.push(m);
      continue;
    }

    const keys = [];
    let allSaved = true;
    for (let ii = 0; ii < legacy.length; ii++) {
      const key = `${lessonId}-legacy-${mi}-${ii}`;
      const compressed = await compressImageDataUrl(legacy[ii]);
      // If compression failed (returned null), skip this image rather than
      // attempting to save oversized data that will hit the 400 KB limit.
      if (compressed && await saveScreenshot(key, compressed)) {
        keys.push(key);
      } else {
        allSaved = false;
        break;
      }
    }

    if (allSaved && keys.length === legacy.length) {
      // Drop the embedded base64 (`imageDataUrls`); keep the rest of metadata.
      const { imageDataUrls: _dropped, ...restMeta } = m.metadata;
      migrated.push({ ...m, metadata: { ...restMeta, imageKeys: keys } });
      changed = true;
    } else {
      // Couldn't durably move every image — leave this message embedded and
      // let a later resume retry. Better a still-bloated record than lost data.
      migrated.push(m);
    }
  }

  if (changed) await replaceLessonMessages(lessonId, migrated);
  return changed ? migrated : messages;
}

/**
 * Resume an existing lesson. Loads messages and KB.
 */
export async function resumeLesson(lessonId) {
  let messages = await getLessonMessages(lessonId);
  // Heal pre-#193 conversations whose embedded base64 images bloated the
  // record. Never while impersonating — `resumeLesson` is read-only for the
  // admin "View as User" audit, and these writes (lacking `?asUserId`) would
  // land on the admin's own account, not the learner's.
  if (!isImpersonating()) {
    messages = await migrateLegacyImages(lessonId, messages);
  }
  messages = await hydrateMessageImages(messages);
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

/**
 * Fetch the distilled cross-lesson progress note for a lesson's course, if any.
 * Returns undefined when the lesson has no course or no note exists yet (so
 * buildContext omits it). Within a session this value only changes via OTHER
 * lessons' completions, so fetching when the lesson opens is sufficient.
 */
async function loadCourseProgressSummary(lesson) {
  if (!lesson?.course?.id) return undefined;
  try {
    const record = await getCourseProgress(lesson.course.id);
    return record?.summary || undefined;
  } catch {
    return undefined;
  }
}

export function buildContext(lesson, lessonKB, profileSummary, learnerName, courseProgress) {
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
  // Optional author-supplied coach directive: high-priority runtime guidance
  // the lesson author baked into the lesson markdown (`## Coach Directive`),
  // e.g. "reference the learner's portfolio project" or "offer this code".
  // Surfaced in both active and completed states — it can carry feedback-mode
  // guidance too. The coach follows it closely but still owns the exemplar and
  // progress (it never overrides completion semantics).
  if (lesson.coachDirective) {
    context.coachDirective = lesson.coachDirective;
  }
  // Optional course taxonomy: when a lesson belongs to a wider course, the
  // server inlines `lesson.course = { id, name }`. Surface the name so the
  // coach can frame this lesson within the course's arc. When a cross-lesson
  // progress note exists for this learner, attach it as `progress` so the coach
  // can connect threads — informational only; it never touches completion.
  if (lesson.course && lesson.course.name) {
    context.course = { name: lesson.course.name };
    if (courseProgress) context.course.progress = courseProgress;
  }
  // Optional enrichment context: plugins can enrich lessons at start time by
  // providing additional reference material (e.g., WordPress docs, React API
  // updates, internal knowledge bases). Stored on `lessonKB.enrichments` after
  // the lessonStarted hook runs. Each enrichment has `{ pluginId, label, context,
  // reasoning, sources }`. The coach can draw on this background context when
  // relevant but it MUST NOT override completion semantics — the coach still owns
  // progress and the exemplar.
  if (lessonKB?.enrichments && Array.isArray(lessonKB.enrichments) && lessonKB.enrichments.length > 0) {
    context.enrichmentContext = lessonKB.enrichments.map(e => ({
      source: e.label || e.pluginId,
      context: e.context || '',
      reasoning: e.reasoning || '',
    }));
  }
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
