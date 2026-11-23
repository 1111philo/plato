/**
 * Lesson engine — conversational coaching toward the exemplar.
 *
 * 1. Lesson starts: Lesson Owner generates KB, Coach opens conversation
 * 2. Learner responds (text or image)
 * 3. Coach evaluates, coaches forward, updates KB + progress
 * 4. Repeat until exemplar achieved
 */

import {
  getLearnerProfileSummary, getPreferences, getAuthUser,
  getLessonKB, saveLessonKB, getCourseProgress, lastSaveResult,
  saveScreenshot, getScreenshot,
  saveLessonMessages, getLessonMessages, replaceLessonMessages,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { authenticatedFetch } from '../../js/auth.js';
import { compressImageDataUrl } from './imageCompression.js';
import { syncIfUnsaved } from './syncDebounce.js';
import { ensureProfileExists, updateProfileOnCompletionInBackground, updateProfileFromObservation } from './profileQueue.js';
import { updateCourseProgressOnCompletionInBackground } from './courseProgressQueue.js';
import { LESSON_PHASES, MSG_TYPES, MAX_EXCHANGES } from './constants.js';
import { coachTurnActivity, lessonStartActivity } from './agentActivity.js';
import { mergeObjectivesMet, objectivesMetForContext } from './lessonWork.js';
import { openTrace } from './traceSession.js';
import { rulesApplied } from './lessonTrace.js';
import {
  assessmentPlan, assessmentTranscript, assessmentInput, groundVerdict, applyVerdict,
  heldCompletionAddendum, allObjectivesMet, parseVerdict, HELD_PROGRESS,
  FORMAT_NOTE, claimsCompletion, heldReply, heldPosition, draftsForLearner, DRAFT_ADDENDUM,
} from './assessment.js';

/** The assessor's retry after a malformed reply: varied, so it isn't the identical request. */
const RETRY_TEMPERATURE = 0.7;

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

/**
 * When a coach reply came back without `[PROGRESS]` or without `[KB_UPDATE]`
 * (where `objectivesMet` lives), ask for its tags
 * (orchestrator.repairCoachTags) and fill in only what's missing. `repair`
 * returns the raw tag text. Never throws. Returns the parsed response plus
 * `tagsRepairTried`, `tagsRecovered` (something missing was filled in), and
 * `tagsMissing` (still no progress: the turn records none, and "Behind this
 * response" says so).
 */
export async function recoverMissingTags(parsed, repair) {
  if (parsed.progress != null && parsed.kbUpdate) {
    return { ...parsed, tagsRepairTried: false, tagsRecovered: false, tagsMissing: false };
  }
  let tags = {};
  try { tags = parseCoachResponse(await repair()); } catch { /* the reply stands as parsed */ }
  const progress = parsed.progress ?? tags.progress ?? null;
  const kbUpdate = parsed.kbUpdate || tags.kbUpdate || null;
  return {
    ...parsed,
    progress,
    kbUpdate,
    profileUpdate: parsed.profileUpdate || tags.profileUpdate || null,
    tagsRepairTried: true,
    tagsRecovered: (parsed.progress == null && progress != null) || (!parsed.kbUpdate && !!kbUpdate),
    tagsMissing: progress == null,
  };
}

/** A coach turn updates the learner profile only when it says so ([PROFILE_UPDATE]). */
/**
 * The grading check for one coach turn (#584; lib/assessment.js). When the
 * reply checks off a new objective or scores 10, `assess(input, images)` asks
 * the assessor which objectives the learner's own words show, and only those
 * stay checked off. When the reply scored 10 but some objective isn't shown,
 * completion is held and `regenerate(addendum)` streams the coach's second
 * try, told what's missing; its score is held to HELD_PROGRESS and its
 * objectives to the ones the check found.
 *
 * Never throws. If the check itself fails, the coach's grading stands, as it
 * did before: a completing turn checks off every objective, so the
 * every-objective rule in applyCoachResponseToKB still lets it complete.
 * Returns `{ parsed, assessment }`; `assessment` is null when nothing was checked.
 */
export async function checkGrading({ lesson, kb, parsed, messages, imageParts = [], assess, regenerate, judgeClaim, onStep }) {
  // `onStep(type, data)` (Trace mode) hears each decision as it is made. It
  // changes nothing: the result is the same with or without it.
  const note = (type, data) => { try { onStep?.(type, data); } catch { /* never breaks grading */ } };
  const ground = (verdict, tr, check) => groundVerdict(verdict, tr, check, { imageThisTurn, ...(onStep ? { evidence: true } : {}) });
  const plan = assessmentPlan(kb, parsed);
  note('gradingPlan', { ...plan, ran: plan.check.length > 0 });
  if (!plan.check.length) return { parsed, assessment: null };
  const imageThisTurn = imageParts.length > 0;
  const transcript = assessmentTranscript(messages);
  const input = assessmentInput({ lesson, kb, transcript, check: plan.check, imageThisTurn });
  let grounded = null;
  try {
    // A reply that isn't JSON gets one retry that says so (at temperature 0
    // the same request returns the same reply). Busy errors are retried by
    // orchestrator.callApi.
    let verdict;
    try { verdict = parseVerdict(await assess(input, imageParts, { purpose: 'grading check' })); } catch (e) {
      note('gradingRetry', { why: String(e?.message || e) });
      verdict = parseVerdict(await assess(assessmentInput({ lesson, kb, transcript, check: plan.check, imageThisTurn, note: FORMAT_NOTE }), imageParts, { temperature: RETRY_TEMPERATURE, purpose: 'grading check, second try (the first reply could not be read)' }));
    }
    grounded = ground(verdict, transcript, plan.check);
    note('verdict', { transcript, verdict, ...grounded });
    // A "shown" whose quote wasn't the learner's (often the coach's paraphrase
    // when the learner's own words were there too, measured on prod): ask once
    // more about just those, saying why. A failed recheck keeps the first answer.
    if (grounded.ungrounded.length) {
      try {
        const recheck = grounded.ungrounded.map((n) => ({ n, problem: grounded.missing[n] }));
        const againVerdict = parseVerdict(await assess(assessmentInput({ lesson, kb, transcript, check: grounded.ungrounded, imageThisTurn, recheck }), imageParts, { purpose: 'grading check, asked again about quotes that were not the learner’s' }));
        const again = ground(againVerdict, transcript, grounded.ungrounded);
        note('recheck', { asked: recheck, verdict: againVerdict, ...again });
        const missing = { ...grounded.missing };
        for (const n of again.shown) delete missing[n];
        grounded = { ...grounded, shown: [...grounded.shown, ...again.shown].sort((a, b) => a - b), missing };
      } catch (e) { note('recheck', { asked: grounded.ungrounded, failed: String(e?.message || e) }); /* keep the first answer */ }
    }
  } catch (e) { note('gradingFailed', { why: String(e?.message || e), failuresBefore: kb.gradingCheckFailures || 0 }); grounded = null; }

  // Fail closed: when the check can't run, nothing new is checked off and a
  // completion waits for a turn it can (playground, 2026-11-21: failing open
  // completed a lesson the check had held for 16 turns). But not forever: a
  // conversation that keeps breaking the assessor (0.4% of prod completions
  // in the replay) would leave that learner unable to finish. On the second
  // completing turn in a row that can't be checked, the coach's grading
  // stands, as before #584, and it's logged for review.
  const failed = !grounded;
  if (failed && plan.completionClaimed && (kb.gradingCheckFailures || 0) >= 1) {
    const all = (kb.objectives || []).map((_, i) => i + 1);
    note('gradingStood', { objectivesMet: all });
    return {
      parsed: { ...parsed, kbUpdate: { ...(parsed.kbUpdate || {}), objectivesMet: all } },
      assessment: { failed: true, failedOpen: true, checked: plan.check.length, shown: 0, unverified: 0, held: false, regenerated: false },
    };
  }
  if (failed) {
    const why = 'couldn’t be checked this turn: ask them to share that part of their work in their own words';
    grounded = { shown: [], missing: Object.fromEntries(plan.check.map((n) => [n, why])), ungrounded: [] };
  }

  const applied = applyVerdict(parsed, kb, plan, grounded);
  note('verdictApplied', {
    held: applied.held, unverified: applied.unverified, outstanding: applied.outstanding, missing: grounded.missing,
    progressBefore: parsed.progress ?? null, progressAfter: applied.parsed.progress ?? null,
    claimed: parsed.kbUpdate?.objectivesMet || [], kept: applied.parsed.kbUpdate?.objectivesMet || [],
  });
  let out = applied.parsed;
  let regenerated = false;
  let replaced = false;
  if (applied.held) {
    if (regenerate) {
      try {
        const second = parseCoachResponse(await regenerate(heldCompletionAddendum(kb, applied.outstanding, grounded.missing)));
        if (second.text) {
          regenerated = true;
          note('heldRewrite', { before: applied.parsed.text, after: second.text, progressAsked: second.progress ?? null, progressKept: Math.min(second.progress ?? out.progress ?? 0, HELD_PROGRESS) });
          const kept = applied.parsed.kbUpdate?.objectivesMet || [];
          out = {
            ...second,
            progress: Math.min(second.progress ?? out.progress ?? 0, HELD_PROGRESS),
            kbUpdate: { ...(second.kbUpdate || applied.parsed.kbUpdate || {}), objectivesMet: kept },
            profileUpdate: second.profileUpdate || parsed.profileUpdate,
          };
        }
      } catch (e) { note('heldRewrite', { failed: String(e?.message || e) }); /* keep the first reply, with completion held */ }
    }
    // The coach's words must agree with the hold. Its second try often still
    // said "this one is complete" (playground testing), so in code: a reply or
    // "Where you are" note that says the lesson is done is replaced.
    // Patterns first; for wording they don't know, a one-word model check
    // (judgeClaim). A failed check keeps the reply.
    const byPattern = claimsCompletion(out.text);
    let saysDone = byPattern;
    let byModel = null;
    if (!saysDone && judgeClaim && out.text) {
      try { saysDone = byModel = await judgeClaim(out.text); } catch { byModel = 'failed'; /* keep the reply */ }
    }
    note('claimCheck', { byPattern, byModel, saysDone });
    if (saysDone) {
      const standard = heldReply(kb, applied.outstanding, grounded.missing);
      note('replyReplaced', { before: out.text, after: standard });
      out = { ...out, text: standard };
      replaced = true;
    }
    if (out.kbUpdate?.learnerPosition && claimsCompletion(out.kbUpdate.learnerPosition)) {
      const standard = heldPosition(kb, applied.outstanding);
      note('positionReplaced', { before: out.kbUpdate.learnerPosition, after: standard });
      out = { ...out, kbUpdate: { ...out.kbUpdate, learnerPosition: standard } };
    }
  }
  return {
    parsed: out,
    assessment: {
      checked: plan.check.length,
      shown: grounded.shown.length,
      unverified: applied.unverified.length,
      held: applied.held,
      regenerated,
      ...(replaced ? { replaced } : {}),
      ...(failed ? { failed } : {}),
    },
  };
}

/**
 * Completing turns in a row the grading check couldn't run, after this turn
 * (checkGrading lets the coach's grading stand once it's 1 and the next one
 * fails too). A turn the check ran, or a fallback, resets it; a failed check
 * on an ordinary turn leaves it as it was.
 */
export function nextGradingFailures(prev = 0, assessment) {
  if (!assessment) return prev || 0;
  if (assessment.failedOpen || !assessment.failed) return 0;
  return assessment.held ? (prev || 0) + 1 : prev || 0;
}

export function shouldUpdateProfile(parsed) {
  return typeof parsed?.profileUpdate?.observation === 'string' && parsed.profileUpdate.observation.trim().length > 0;
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
  // Trace mode (#595): a recorder when it's on, else undefined. A start that
  // fails still leaves its trace.
  const trace = await openTrace(lessonId, 'start');
  try {
    return await startLessonTraced(lessonId, lesson, onStream, onProgress, trace);
  } catch (e) {
    trace?.fail(e);
    throw e;
  } finally {
    trace?.flush();
  }
}

async function startLessonTraced(lessonId, lesson, onStream, onProgress, trace) {
  await ensureProfileExists();
  const profileSummary = await getLearnerProfileSummary();
  trace?.step('lesson', lessonForTrace(lesson));

  // Lesson Owner generates the KB
  if (onProgress) onProgress('initializing');
  const lessonKB = await orchestrator.initializeLessonKB(lesson, profileSummary, { trace });
  // What the planner wrote, before plato's code sets the fields it owns.
  trace?.step('planned', { fromModel: { ...lessonKB }, authorObjectives: lesson.learningObjectives || [], authorExemplar: lesson.exemplar || '' });
  lessonKB.lessonId = lessonId;
  lessonKB.name = lesson.name;
  lessonKB.progress = 0;
  lessonKB.startedAt = ts();

  // Emit lessonStarted hook and collect enrichments from plugins
  let enrichments = [];
  try {
    if (onProgress) onProgress('enriching', { enrichments: [] });
    const res = await authenticatedFetch('/v1/sync/lesson-started', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId,
        lesson: {
          name: lesson.name,
          markdown: lesson.markdown,
          exemplar: lesson.exemplar,
          learningObjectives: lesson.learningObjectives,
          coachDirective: lesson.coachDirective,
        },
        lessonKB,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      enrichments = data.enrichments || [];
    }
    trace?.step('plugins', { status: res.status, enrichments });
  } catch (err) {
    // Fail open — enrichment errors must never block lesson start
    console.warn('[startLesson] Failed to collect enrichments:', err);
    trace?.step('plugins', { failed: String(err?.message || err), enrichments: [] });
  }

  // One KB write before the coach opens, with the enrichments in it (a later
  // write would race the coach's progress update). It used to be written up
  // to three times, each re-sent in the background (#451 scale review H2).
  if (enrichments.length > 0) lessonKB.enrichments = enrichments;
  // The lesson is being recorded from its start (set only when Trace is on,
  // and after the plugins have seen the KB: it's about the recording, not
  // the lesson).
  if (trace) lessonKB.trace = { since: lessonKB.startedAt, by: trace.app?.by || 'self' };
  syncIfUnsaved(await saveLessonKB(lessonId, lessonKB), `lessonKB:${lessonId}`);
  trace?.step('save', { record: 'lessonKB', ...lastSaveResult(`lessonKB:${lessonId}`) });

  // Coach opens the conversation
  if (onProgress) onProgress('starting');
  const name = await learnerFirstName();
  const courseProgress = await loadCourseProgressSummary(lesson);
  const context = buildContext(lesson, lessonKB, profileSummary, name, courseProgress);
  const opening = [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: 'Start the lesson.' }];
  trace?.step('context', { context: JSON.parse(context) });
  trace?.setBase(opening);
  const coachMsg = await orchestrator.converseStream(
    'coach',
    opening,
    cleanStream(onStream),
    1024,
    '',
    trace ? { trace, purpose: 'opening message' } : undefined,
  );

  const { text, progress } = parseCoachResponse(coachMsg);
  trace?.step('parsed', { raw: coachMsg, text, progress, opener: true });

  // The opener is scored like any turn (clamped 0–10), but it can't finish
  // the lesson: nothing has been shown yet, and only applyCoachResponseToKB
  // completes lessons. A lesson's Coach Directive can't change that.
  const openingScore = openingProgress(progress);
  trace?.step('applied', { opener: true, modelProgress: progress, progress: openingScore ?? lessonKB.progress, rules: openingScore != null && progress != null && openingScore !== progress ? ['openerCap'] : [] });
  if (openingScore != null && openingScore !== lessonKB.progress) {
    lessonKB.progress = openingScore;
    syncIfUnsaved(await saveLessonKB(lessonId, lessonKB), `lessonKB:${lessonId}`);
    trace?.step('save', { record: 'lessonKB', ...lastSaveResult(`lessonKB:${lessonId}`) });
  }

  const agents = lessonStartActivity({ lessonKB, enrichments, hasUnitNote: !!courseProgress });
  const messages = [
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: LESSON_PHASES.LEARNING, metadata: { agents }, timestamp: ts() },
  ];

  const savedMessages = await saveLessonMessages(lessonId, messages);
  // Retry the opener once in the background if it didn't land ('too_long' was never sent; there's nothing to retry).
  if (savedMessages !== 'too_long') syncIfUnsaved(savedMessages, `messages:${lessonId}`);
  trace?.step('save', { record: 'messages', ...(savedMessages === 'too_long' ? { ok: false, code: 'too_long' } : lastSaveResult(`messages:${lessonId}`)) });
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
  // Trace mode (#595): a recorder when it's on, else undefined. A lesson that
  // started before it was turned on is recorded from here and marked partial.
  const trace = await openTrace(lessonId, 'turn', { partial: !lessonKB?.trace || !!lessonKB.trace.partial });
  if (trace && lessonKB && !lessonKB.trace) lessonKB = { ...lessonKB, trace: { since: ts(), by: trace.app?.by || 'self', partial: true } };
  try {
    return await sendMessageTraced(lessonId, lesson, text, imageDataUrl, links, onStream, lessonKB, trace);
  } catch (e) {
    trace?.fail(e);
    throw e;
  } finally {
    trace?.flush();
  }
}

async function sendMessageTraced(lessonId, lesson, text, imageDataUrl, links, onStream, lessonKB, trace) {
  const profileSummary = await getLearnerProfileSummary();
  // Events the server logs (a code and the lesson id only), noted in the trace too.
  const report = (code) => { orchestrator.reportEvent(code, { lessonId }); trace?.step('event', { code }); };
  // What the learner watched arrive, when a later reply replaced it.
  let streamed = 0;
  const stream = trace ? (...a) => { streamed++; return cleanStream(onStream)(...a); } : cleanStream(onStream);
  const opts = (purpose) => (trace ? { trace, purpose } : undefined);

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
  trace?.step('lesson', lessonForTrace(lesson));
  trace?.step('input', {
    text: text || '',
    images: imageDataUrls.map((url, i) => {
      const type = (url.match(/^data:([^;,]+)/) || [])[1] || null;
      // buildUserParts sends an image only when its type is a plain word (image/png).
      return { key: imageKeys[i], type, chars: url.length, sent: /^data:(image\/\w+);base64,/.test(url) };
    }),
    links: linkList.map((l) => ({ url: l.url, title: l.title || null, chars: (l.text || '').length, ...(l.truncated ? { truncated: true } : {}), ...(l.finalUrl && l.finalUrl !== l.url ? { finalUrl: l.finalUrl } : {}) })),
  });
  trace?.step('state', {
    progress: lessonKB.progress ?? 0, status: lessonKB.status || 'active',
    objectivesMet: lessonKB.objectivesMet || [], activitiesCompleted: lessonKB.activitiesCompleted || 0,
    gradingCheckFailures: lessonKB.gradingCheckFailures || 0,
  });

  // Build conversation tail — filter out messages with empty content (e.g. image-only)
  // Target: 11 exchanges (22 msgs), but over-target avg is 15.9 exchanges (~32 msgs).
  // Set to 40 to cover outliers up to 22 exchanges without being unlimited.
  const allMsgs = await getLessonMessages(lessonId);
  const tail = allMsgs.slice(-40)
    .map(m => ({ role: m.role, content: m.content }))
    .filter(m => m.content && (typeof m.content === 'string' ? m.content.trim() : m.content.length));
  trace?.step('tail', {
    stored: allMsgs.length, sent: tail.length, olderLeftOut: Math.max(0, allMsgs.length - 40),
    // Earlier images and attached pages aren't sent again: only this turn's are.
    earlierImages: allMsgs.filter((m) => m.metadata?.imageKeys?.length).length,
    earlierLinks: allMsgs.filter((m) => m.metadata?.links?.length).length,
  });

  // Build user message content (text, link page-text, then images)
  const userParts = buildUserParts(text, imageDataUrls, linkList);

  // Always include context as first message so coach has lesson + profile info
  const name = await learnerFirstName();
  const courseProgress = await loadCourseProgressSummary(lesson);
  const contextMsg = buildContext(lesson, lessonKB, profileSummary, name, courseProgress);
  const messages = [{ role: 'user', content: contextMsg }, { role: 'assistant', content: 'Ready.' }, ...tail];
  // Collapse to a plain string only when the turn is a single text block.
  messages.push({ role: 'user', content: userParts.length === 1 && userParts[0].type === 'text' ? userParts[0].text : userParts });
  trace?.step('context', { context: JSON.parse(contextMsg) });
  trace?.setBase(messages);

  // 2048: a long explanation at 1024 ran out mid-reply (the turn fails with
  // "The reply was cut off", since the tags come last).
  const coachMsg = await orchestrator.converseStream(
    'coach',
    messages,
    stream,
    2048,
    '',
    opts('reply'),
  );

  const firstParse = parseCoachResponse(coachMsg);
  trace?.step('parsed', { raw: coachMsg, ...firstParse });
  const repaired = await recoverMissingTags(
    firstParse,
    () => orchestrator.repairCoachTags(messages, stripTags(coachMsg), opts('tag repair')),
  );
  // Visible in /v1/admin/logs, so the drop rate on prod isn't a guess.
  if (repaired.tagsRepairTried) {
    trace?.step('tagRepair', { missing: repaired.tagsMissing || null, recovered: !!repaired.tagsRecovered, progress: repaired.progress, kbUpdate: repaired.kbUpdate || null, profileUpdate: repaired.profileUpdate || null });
    report(repaired.progress != null && repaired.kbUpdate ? 'coach_tags_recovered' : 'coach_tags_unrecovered');
  }

  // The draft guard (#584): a reply that writes the learner's answer for them
  // (a quoted sentence to adopt, "Here's a draft: …") is rewritten once as
  // feedback plus a question. Learners copied these drafts, and the grading
  // check then (rightly) didn't count them. The rewrite streams in place and
  // is kept even when it still drafts: going back to the first reply made the
  // learner watch it switch twice (playground: the rewrite still drafted 21
  // of 26 times). A failed rewrite keeps the first reply.
  let coachReply = repaired;
  if (lessonKB.status !== 'completed' && draftsForLearner(repaired.text)) {
    try {
      const raw = await orchestrator.converseStream('coach', messages, stream, 2048, DRAFT_ADDENDUM, opts('rewrite: the first reply wrote the learner’s answer for them'));
      const again = await recoverMissingTags(parseCoachResponse(raw), () => orchestrator.repairCoachTags(messages, stripTags(raw), opts('tag repair, for the rewrite')));
      if (again.text) coachReply = { ...again, draftRewritten: !draftsForLearner(again.text) };
      trace?.step('draftGuard', { before: repaired.text, after: again.text || null, used: !!again.text, stillDrafts: again.text ? !coachReply.draftRewritten : null, progress: again.progress ?? null });
    } catch (e) { trace?.step('draftGuard', { before: repaired.text, failed: String(e?.message || e), used: false }); /* keep the first reply */ }
    report(coachReply.draftRewritten ? 'coach_draft_rewritten' : 'coach_draft_kept');
  }

  // The grading check (#584): objectives stay checked off only when the
  // learner's own words show them, and a completion that isn't backed up is
  // held while the coach asks for what's missing (its second try streams in
  // place of the first).
  const graded = await checkGrading({
    lesson, kb: lessonKB, parsed: coachReply, messages,
    imageParts: userParts.filter((p) => p.type === 'image'),
    // Only the recorder and its label are passed on: the request itself is
    // the same with Trace on or off.
    assess: (input, images, o) => (trace ? orchestrator.assessTurn(input, images, { trace, purpose: o?.purpose }) : orchestrator.assessTurn(input, images)),
    regenerate: (addendum) => orchestrator.converseStream('coach', messages, stream, 2048, addendum, opts('rewrite: completion was held')),
    judgeClaim: (t) => orchestrator.checkCompletionClaim(t, opts()),
    ...(trace ? { onStep: (type, data) => trace.step(type, data) } : {}),
  });
  const parsed = graded.parsed;
  const assessment = graded.assessment;
  if (assessment?.failedOpen) report('coach_assessment_failed_open');
  else if (assessment?.failed) report('coach_assessment_failed');
  else if (assessment?.held) report('coach_completion_held');
  else if (assessment?.unverified) report('coach_objectives_unverified');

  const kbBefore = { progress: lessonKB.progress, status: lessonKB.status };
  const kbBeforeFull = lessonKB;
  // The objectives checklist (#438) first, against the KB as it was, so the
  // turn that completes the lesson can still check off what it showed.
  // Informational only: applyCoachResponseToKB alone decides completion.
  const metBefore = new Set(lessonKB.objectivesMet || []);
  const withMet = mergeObjectivesMet(lessonKB, parsed.kbUpdate);
  const newlyMet = (withMet.objectivesMet || []).filter((i) => !metBefore.has(i))
    .map((i) => withMet.objectives?.[i]?.objective).filter(Boolean);
  const applied = applyCoachResponseToKB(withMet, parsed, { now: ts });
  lessonKB = applied.lessonKB;
  // Completing turns in a row the check couldn't run (checkGrading lets the
  // coach's grading stand on the second). Any turn the check ran resets it.
  if (assessment) {
    const failures = nextGradingFailures(lessonKB.gradingCheckFailures, assessment);
    if (failures || lessonKB.gradingCheckFailures) lessonKB = { ...lessonKB, gradingCheckFailures: failures };
  }
  const { achieved, phase } = applied;
  trace?.step('applied', rulesApplied({ before: kbBeforeFull, after: lessonKB, modelProgress: firstParse.progress, replyProgress: coachReply.progress, parsed, assessment, achieved, newlyMet }));

  syncIfUnsaved(await saveLessonKB(lessonId, lessonKB), `lessonKB:${lessonId}`);
  trace?.step('save', { record: 'lessonKB', ...lastSaveResult(`lessonKB:${lessonId}`) });

  // The profile is updated from the coach's explicit [PROFILE_UPDATE] only
  // (and on completion). Treating every turn's KB insights as a profile
  // signal made most turns cost a second model call (#451 scale review H2).
  if (shouldUpdateProfile(parsed)) {
    updateProfileFromObservation(lessonKB, parsed.profileUpdate.observation);
    trace?.step('followUp', { agent: 'learner-profile-update', why: 'the coach noted something about the learner', observation: parsed.profileUpdate.observation });
  }
  if (achieved) {
    updateProfileOnCompletionInBackground(lessonKB, lesson);
    trace?.step('followUp', { agent: 'learner-profile-owner', why: 'the lesson was completed' });
    // When the lesson belongs to a course, refresh the cross-lesson progress
    // note so the coach for sibling lessons sees what was just demonstrated.
    if (lesson.course?.id) {
      updateCourseProgressOnCompletionInBackground(lessonKB, lesson);
      trace?.step('followUp', { agent: 'course-progress-update', why: 'the lesson was completed and belongs to a unit' });
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
  // What each agent read and did on this turn (#411), for "Behind this response".
  const agents = coachTurnActivity({
    before: kbBefore, after: lessonKB, parsed, achieved, newlyMet, assessment,
    images: imageDataUrls.length, links: linkList.length,
    hasUnitNote: !!courseProgress,
    unitName: lesson.course?.id ? (lesson.unit?.name || lesson.course?.name) : null,
  });
  const assistantMsg = { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE, phase, metadata: { agents }, timestamp: ts() };
  trace?.step('shown', { text: parsed.text, firstStreamed: stripTags(coachMsg), replaced: stripTags(coachMsg) !== parsed.text, streamedUpdates: streamed, behindThisResponse: agents });

  // true = saved. false = the server refused it; 'too_long' = not sent (past
  // the size budget). Either way tell the learner, and don't retry in the
  // background: it would send the same record. (The cache keeps the turn, so
  // the next save tries it again.)
  const saved = await saveLessonMessages(lessonId, [persistedUserMsg, assistantMsg]);

  const userMsg = imageDataUrls.length > 0
    ? { ...persistedUserMsg, metadata: { ...persistedUserMsg.metadata, imageDataUrls: [...imageDataUrls] } }
    : persistedUserMsg;
  // 'too_long': the conversation itself is past the size limit, so later
  // turns won't save either (saveLessonMessages doesn't even send it).
  const saveFailed = saved === 'too_long' ? 'too_long' : saved === false;
  trace?.step('save', { record: 'messages', ...(saved === 'too_long' ? { ok: false, code: 'too_long' } : lastSaveResult(`messages:${lessonId}`)) });
  if (saveFailed === 'too_long') report('conversation_too_long');
  return { messages: [userMsg, assistantMsg], progress: parsed.progress, achieved, phase, saveFailed };
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

/** Progress is a 0–10 signal; a lesson completes at MAX_PROGRESS. */
const MAX_PROGRESS = 10;

/** The lesson opener's score: clamped 0–10 and never 10 (it can't complete a lesson). */
export function openingProgress(progress) {
  const p = clampProgress(progress);
  return p == null ? null : Math.min(p, MAX_PROGRESS - 1);
}

/**
 * Coerce a coach-reported progress score into the 0–10 range.
 * Returns null for anything non-numeric so callers can treat it as "no score".
 */
function clampProgress(progress) {
  // Guard null/undefined/'' explicitly — Number() coerces all three to 0, which
  // would silently reset a lesson's progress when the coach reports no score.
  if (progress == null || progress === '') return null;
  const n = Number(progress);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_PROGRESS, Math.max(0, Math.round(n)));
}

/**
 * Apply a parsed coach response to a lesson KB. Pure — returns a new KB
 * without mutating the input. Centralizes the "feedback mode" invariant:
 * once a lesson is completed, progress and the exchange counter both freeze
 * and `achieved` can't re-fire, so one-shot side effects (confetti, completion
 * profile update) stay one-shot across the feedback conversation that follows.
 *
 * This function is the single owner of completion semantics — it must not
 * delegate any part of that to the model's willingness to follow the prompt.
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
  // Progress is frozen once the lesson is complete. The coach prompt says not to
  // assess or award progress in a completed thread, but that's prose in a long
  // prompt — compliance varies by model (open-weight candidates evaluated for
  // per-agent routing emit [PROGRESS: 10] on post-completion turns where Haiku
  // correctly emits no tag). Completion semantics must not depend on a model
  // following an instruction, so the freeze lives here.
  //
  // A null clamp means the score was absent or unparseable — leave the stored
  // value alone rather than overwriting it with nothing.
  let reportedProgress = clampProgress(parsed.progress);
  // A lesson completes only when every objective is checked off (#584). The
  // coach's 10 alone isn't enough: on its own it completed lessons on one-line
  // answers. sendMessage's grading check decides which objectives are checked
  // off (client/src/lib/assessment.js); this is the rule. Lessons without
  // objectives keep the old behavior.
  if (reportedProgress >= MAX_PROGRESS && !wasCompleted && !allObjectivesMet(next)) {
    reportedProgress = MAX_PROGRESS - 1;
  }
  if (reportedProgress != null && !wasCompleted) {
    next.progress = reportedProgress;
  }
  if (!wasCompleted) {
    next.activitiesCompleted = (next.activitiesCompleted || 0) + 1;
  }

  // `achieved` means "just achieved on this turn" — one-shot. Without this
  // guard it would re-fire on every post-completion message, triggering
  // confetti + completion-profile updates repeatedly in the feedback thread.
  // Compare the clamped value so a malformed out-of-range score can't complete
  // a lesson that the stored progress doesn't reflect.
  const achieved = reportedProgress >= MAX_PROGRESS && !wasCompleted;
  if (achieved) {
    next.status = 'completed';
    next.completedAt = now();
  }
  const phase = next.status === 'completed' ? LESSON_PHASES.COMPLETED : LESSON_PHASES.LEARNING;
  return { lessonKB: next, achieved, phase };
}

/**
 * The learner's first name for the coach (#402): from the signed-in account,
 * which `/v1/me` refreshes on every load, so it's set from signup on. Falls
 * back to the old `preferences.name`, which was blank until the learner saved
 * Settings.
 */
async function learnerFirstName() {
  const user = await getAuthUser().catch(() => null);
  if (user?.firstName) return user.firstName;
  const prefs = await getPreferences().catch(() => null);
  return (prefs?.name || user?.name || '').trim().split(/\s+/)[0] || '';
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

/** The lesson as the author wrote it, for a Trace: which lesson, which version, and the parts the coach is given. */
function lessonForTrace(lesson) {
  return {
    lessonId: lesson?.lessonId || null, name: lesson?.name || null, updatedAt: lesson?.updatedAt || null,
    exemplar: lesson?.exemplar || '', learningObjectives: lesson?.learningObjectives || [], coachDirective: lesson?.coachDirective || '',
    unit: lesson?.unit?.name || lesson?.course?.name || null, course: lesson?.program?.name || null,
  };
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
  // Objectives the coach has already marked as shown (#438), 1-based.
  const met = objectivesMetForContext(lessonKB);
  if (met) context.objectivesMet = met;
  // Optional author-supplied coach directive: high-priority runtime guidance
  // the lesson author baked into the lesson markdown (`## Coach Directive`),
  // e.g. "reference the learner's portfolio project" or "offer this code".
  // Surfaced in both active and completed states — it can carry feedback-mode
  // guidance too. The coach follows it closely but still owns the exemplar and
  // progress (it never overrides completion semantics).
  if (lesson.coachDirective) {
    context.coachDirective = lesson.coachDirective;
  }
  // Optional placement (#408): the server inlines the lesson's unit (still
  // stored as `lesson.course`) and the course above it (`lesson.program`).
  // Surface the names so the coach can frame this lesson within that arc.
  // The cross-lesson progress note is per unit (`courseProgress:<unitId>`);
  // it rides on `unit.progress` and is informational only; it never touches
  // completion.
  const unitName = lesson.unit?.name || lesson.course?.name;
  if (unitName) {
    context.unit = { name: unitName };
    if (courseProgress) context.unit.progress = courseProgress;
  }
  if (lesson.program?.name) {
    context.course = { name: lesson.program.name };
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
