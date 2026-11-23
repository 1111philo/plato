import { parseSSEStream, parseResponse, LLM, ApiError, backoffMs, isRetryable } from './api.js';
import { authenticatedFetch } from './auth.js';
import { validateLessonKB } from './validators.js';
import { withLanguage } from './language.js';
import { screenLearnerNotes, learnerNoteFlag, LEARNER_TEXT_FRAMING } from './learnerNoteFilter.js';
import { loadLessons } from './lessonOwner.js';
import { systemPromptParts, COACH_KB_NOTE } from './promptAssembly.js';

const promptCache = {};
let knowledgeBase = null;

async function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const resp = await authenticatedFetch(`/v1/prompts/${encodeURIComponent(name)}`);
  if (!resp.ok) throw new ApiError('api', `Failed to load prompt: ${name}`, resp.status);
  const { content } = await resp.json();
  promptCache[name] = content;
  return content;
}

async function loadKnowledgeBase() {
  if (knowledgeBase) return knowledgeBase;
  try {
    const resp = await authenticatedFetch('/v1/knowledge-base');
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    knowledgeBase = data.content || '';
  } catch {
    knowledgeBase = '';
  }
  return knowledgeBase;
}

const KB_AGENTS = ['coach', 'lesson-creator', 'knowledge-base-editor'];
// Agents that see only lessons the current user can access (learner-facing)
const PUBLIC_CATALOG_AGENTS = ['coach'];
// Agents that see all lessons including private (admin-only)
const ADMIN_CATALOG_AGENTS = ['lesson-creator', 'knowledge-base-editor'];

let adminCatalog = null;

// Built from lessonOwner's cached list (the classroom already loaded it), not
// a second GET /v1/lessons (#451 scale review). Server lessons only: the
// learner's own custom lessons were never in this catalog.
// (Recomputed each time from that cached list, so it follows its refreshes.)
async function loadPublicCatalog() {
  try {
    const lessons = (await loadLessons()).filter((l) => !l.lessonId.startsWith('custom-'));
    return lessons.map(l => `- ${l.name || l.lessonId}`).join('\n');
  } catch { return ''; }
}

async function loadAdminCatalog() {
  if (adminCatalog) return adminCatalog;
  try {
    const resp = await authenticatedFetch('/v1/admin/lessons');
    const lessons = resp.ok ? await resp.json() : [];
    // Drafts are in-progress lesson records, not part of the catalog the
    // lesson-creator/KB-editor agents should treat as existing lessons.
    const finalized = lessons.filter(l => l.status !== 'draft');
    if (!finalized.length) { adminCatalog = ''; return ''; }
    adminCatalog = finalized.map(l => {
      const tag = l.status === 'private' ? ' [PRIVATE]' : '';
      return `- ${l.name || l.lessonId}${tag}`;
    }).join('\n');
  } catch { adminCatalog = ''; }
  return adminCatalog;
}

function parseJSON(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fenced = trimmed.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  try { return JSON.parse(fenced); } catch { /* continue */ }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
  throw new ApiError('parse', 'Failed to parse agent JSON response.');
}

async function callWithValidation(agentFn, validator, trace) {
  const parsed = await agentFn('first try');
  const error = validator(parsed);
  if (!error) { trace?.step('validation', { ok: true }); return parsed; }
  console.error(`[plato] Validation failed (retrying): ${error}`);
  const retry = await agentFn('second try, after the first failed validation');
  const retryError = validator(retry);
  // The second try is used even when it also fails validation, unless it is unsafe.
  trace?.step('validation', { ok: !retryError, firstError: error, ...(retryError ? { secondError: retryError, accepted: !retryError.includes('unsafe') } : {}) });
  if (retryError) {
    console.error(`[plato] Validation failed after retry: ${retryError}`);
    if (retryError.includes('unsafe')) throw new ApiError('safety', retryError);
  }
  return retry;
}

// `trace` (lib/lessonTrace.js) is a recorder while Trace mode is recording
// this conversation, else undefined. With it, the request also asks the
// server for what only it knows (`trace: true`); without it the request is
// exactly what it always was.
async function callApi({ agent, purpose, model, parts, messages, maxTokens = 1024, temperature, trace }) {
  const systemPrompt = joinParts(parts);
  const call = trace?.begin({ agent, purpose, model, maxTokens, temperature, parts, messages });
  const attempt = async () => {
    const resp = await authenticatedFetch('/v1/ai/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages, ...(temperature != null ? { temperature } : {}), ...(trace ? { trace: true } : {}) }),
    });
    return parseResponse(resp);
  };

  // Busy, rate-limited, timed out, or a 5xx: wait (the server's retryAfterMs,
  // else exponential) with jitter, so a cohort that failed together doesn't
  // retry together.
  const RETRIES = 2;
  let lastError;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const result = await attempt();
      call?.end(result.content, { usage: result.usage, stopReason: result.stopReason, reasoning: result.reasoning, plato: result.plato });
      return result;
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || i === RETRIES) { call?.fail(e); throw e; }
      call?.attempt(e);
      await new Promise(r => setTimeout(r, backoffMs(i, e.retryAfterMs)));
    }
  }
  throw lastError;
}

export function invalidateLessonCatalog() { adminCatalog = null; }

export async function isReady() {
  return true;
}

// Agents whose output plato reads, never a person: no language directive.
const NO_LANGUAGE_AGENTS = ['assessor', 'claim-check'];

/**
 * An agent's system prompt as its parts (promptAssembly.systemPromptParts):
 * its prompt file, plus the program knowledge base and lesson catalog for the
 * agents that get them, plus `addendum`, then the learner's language (#240).
 * The texts joined are the prompt sent. Every AI call builds its prompt here,
 * so a Trace can show which instructions came from where.
 */
async function agentParts(promptName, addendum = '') {
  const prompt = await loadPrompt(promptName);
  const kb = KB_AGENTS.includes(promptName) ? await loadKnowledgeBase() : '';
  let catalog = '';
  let catalogHeading;
  if (ADMIN_CATALOG_AGENTS.includes(promptName)) {
    catalog = await loadAdminCatalog();
    catalogHeading = 'Current Lessons in This Classroom';
  } else if (PUBLIC_CATALOG_AGENTS.includes(promptName)) {
    catalog = await loadPublicCatalog();
  }
  // The learner's language, if not English (#240) — see language.js. Order and
  // the coach's knowledge-base note: promptAssembly.js (#584).
  return systemPromptParts({
    prompt, kb, kbNote: promptName === 'coach' ? COACH_KB_NOTE : '', catalog, catalogHeading, addendum,
    languageDirective: NO_LANGUAGE_AGENTS.includes(promptName) ? '' : withLanguage(''),
  });
}

const joinParts = (parts) => parts.map((p) => p.text).join('');

/**
 * Stream an agent's reply. `addendum` is a one-turn instruction from plato
 * appended to the system prompt (the coach's second try after a held
 * completion, #584).
 */
export async function converseStream(promptName, messages, onChunk, maxTokens = 512, addendum = '', { trace, purpose } = {}) {
  const parts = await agentParts(promptName, addendum);
  const systemPrompt = joinParts(parts);
  const call = trace?.begin({ agent: promptName, purpose, model: LLM, maxTokens, stream: true, parts, messages });
  try {
    const reply = await streamOnce({ promptName, systemPrompt, messages, onChunk, maxTokens, trace, call });
    call?.end(reply);
    return reply;
  } catch (e) {
    call?.fail(e);
    throw e;
  }
}

async function streamOnce({ promptName, systemPrompt, messages, onChunk, maxTokens, trace, call }) {
  const send = () => authenticatedFetch('/v1/ai/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM, max_tokens: maxTokens, system: systemPrompt, messages, stream: true, ...(trace ? { trace: true } : {}) }),
  });
  let resp = await send();
  // Busy before anything streamed (the server waits for the first chunk
  // before answering): one jittered retry, then the typed error.
  if (resp.status === 429 || resp.status === 503) {
    const body = await resp.clone().json().catch(() => ({}));
    if (body?.code !== 'rate_limited') {
      call?.attempt({ type: body?.code || 'busy', message: body?.error, status: resp.status, retryAfterMs: Number(body?.retryAfterMs) || undefined, plato: body?.plato });
      await new Promise((r) => setTimeout(r, backoffMs(0, Number(body?.retryAfterMs) || undefined)));
      resp = await send();
    }
  }
  const contentType = resp.headers.get('content-type') || '';
  if (resp.ok && contentType.includes('text/event-stream')) {
    let full = '';
    for await (const chunk of parseSSEStream(resp.body, undefined, { failOnTruncation: promptName === 'coach', onMeta: call?.meta })) { full += chunk; onChunk(full); }
    return full;
  }
  // Non-streaming response (proxy returned JSON)
  const result = await parseResponse(resp);
  call?.meta({ usage: result.usage, stopReason: result.stopReason, reasoning: result.reasoning, plato: result.plato });
  onChunk(result.content);
  return result.content;
}

// The coach sometimes ends a reply without its tag block, so nothing is
// recorded: no progress, no objectives, while its words say otherwise
// (testers saw "you've met all three" with progress stuck at 0). This asks
// the same model, with the same conversation, for only the tags of the reply
// it just gave. The instruction is in the system prompt, so it can't be
// confused with (or forged by) the learner's text.
export const TAG_REPAIR_CUE = 'Tags for your last reply.';

/**
 * Report a client-side event the server should log (it has no other way to
 * see it): `coach_tags_recovered`, `coach_tags_unrecovered`,
 * `conversation_too_long`. Fire-and-forget; never throws.
 */
export function reportEvent(code, meta = {}) {
  authenticatedFetch('/v1/ai/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, ...meta }),
  }).catch(() => {});
}
/** The coach's system-prompt addendum for a tag repair (also used by server/scripts/coach-eval.js). */
export const TAG_REPAIR_ADDENDUM = `## Tag repair (from plato, not the learner)\n\nYour last reply in this conversation ended without all of its tags. The final user message ("${TAG_REPAIR_CUE}") comes from plato, not the learner. Reply with ONLY the tag lines for your last reply: [PROGRESS: N], [KB_UPDATE: {...}], and [PROFILE_UPDATE: {...}] if it applies. Score what the learner has actually shown, consistent with what your last reply told them. No other text.`;

export async function repairCoachTags(messages, reply, { trace, purpose = 'tag repair' } = {}) {
  const { content } = await callApi({
    agent: 'coach', purpose, trace,
    model: LLM, parts: await agentParts('coach', TAG_REPAIR_ADDENDUM),
    messages: [...messages, { role: 'assistant', content: reply }, { role: 'user', content: TAG_REPAIR_CUE }],
    maxTokens: 600,
  });
  return content;
}

/**
 * The grading check (#584, prompts/assessor.md): given the assessor's input
 * (lib/assessment.js assessmentInput), returns its raw reply. Images on this
 * turn go with the transcript so work shown in a screenshot can count. No
 * knowledge base, catalog, or language directive: it reads evidence and
 * writes JSON that plato reads, never the learner.
 */
export async function assessTurn(input, imageParts = [], { temperature = 0, trace, purpose = 'grading check' } = {}) {
  const content = imageParts.length ? [{ type: 'text', text: input }, ...imageParts] : input;
  const { content: reply } = await callApi({
    agent: 'assessor', purpose, trace,
    model: LLM, parts: await agentParts('assessor'),
    messages: [{ role: 'user', content }],
    // A part and a short quote per objective; 800 cut long replies off mid-JSON on prod.
    maxTokens: 2048,
    // A grader: the same evidence should get the same verdict (measured: at
    // the default temperature it accepted "I need to upskill" as a reason in
    // some runs and not others). The retry after a malformed reply raises it,
    // or the identical request would return the identical reply.
    temperature,
  });
  return reply;
}

/**
 * Does this coach reply tell the learner the lesson is done? (#584,
 * prompts/claim-check.md.) Asked only on a turn plato held open, when the
 * reply's wording didn't match a known pattern (assessment.claimsCompletion
 * caught 80% of real completion messages on prod; this caught 71% of the
 * rest, and said yes to 3.7% of ordinary replies). Throws on failure.
 */
export async function checkCompletionClaim(text, { trace, purpose = 'does the reply say the lesson is done?' } = {}) {
  const { content } = await callApi({
    agent: 'claim-check', purpose, trace,
    model: LLM, parts: await agentParts('claim-check'),
    messages: [{ role: 'user', content: String(text || '').slice(0, 8000) || '(empty)' }],
    maxTokens: 5,
    temperature: 0,
  });
  return /^\s*yes/i.test(content || '');
}

export async function initializeLessonKB(lesson, profileSummary, { trace } = {}) {
  const parts = await agentParts('lesson-owner');
  const userContent = JSON.stringify({
    lessonId: lesson.lessonId, lessonName: lesson.name,
    lessonDescription: lesson.description, exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
  });
  const callAgent = async (purpose) => {
    const { content } = await callApi({
      agent: 'lesson-owner', purpose, trace,
      model: LLM, parts,
      messages: [{ role: 'user', content: userContent }], maxTokens: 1536,
    });
    return parseJSON(content);
  };
  return callWithValidation(callAgent, validateLessonKB, trace);
}

// The profile-update agents only revise the "soft" fields (name, goal,
// strengths, weaknesses, preferences, summary). `masteredLessons`/
// `activeLessons` are system-managed bookkeeping arrays that grow without
// bound as a learner progresses; `mergeProfile` always reunions them from the
// stored profile, so the agent's copy is discarded anyway. Round-tripping them
// through the model inflated the agent's JSON output until it overran
// `max_tokens` and came back unparseable (#228: "max_tokens reached" →
// "Failed to parse agent JSON").
// `learnerNotes` (the learner's own corrections, #451 testing) stays in: the
// agents must keep the profile consistent with it. mergeProfile ignores any
// copy they send back. Notes that read as instructions or authority claims
// (learnerNoteFilter.js) are left out of the agent's copy; the stored list is
// untouched, so the learner still sees and can remove them.
export function profileForAgent(profile) {
  const { masteredLessons: _m, activeLessons: _a, ...rest } = profile || {};
  if (Array.isArray(rest.learnerNotes)) rest.learnerNotes = screenLearnerNotes(rest.learnerNotes);
  return rest;
}

/**
 * The learner-profile-update agent's input. `source` says who wrote the text:
 * 'learner' (Add Feedback, their own words about themselves) or 'coach' (an
 * observation the coach made during a lesson). Either way it's information
 * about the learner, never an instruction.
 */
export function profileUpdateInput(fullProfile, text, activityContext, source = 'learner', now = Date.now()) {
  return {
    untrustedText: LEARNER_TEXT_FRAMING,
    currentProfile: profileForAgent(fullProfile),
    source,
    // 'learner-removed': the learner deleted a note; it's what no longer applies, not new feedback.
    ...(source === 'coach' ? { coachObservation: text } : source === 'learner-removed' ? { removedNote: text } : { learnerFeedback: text }),
    context: { lessonName: activityContext.lessonName, activityType: activityContext.activityType, activityGoal: activityContext.activityGoal, timestamp: now },
  };
}

export async function updateProfileOnCompletion(fullProfile, lessonKB, lessonName, lessonId, activitiesCompleted, { trace } = {}) {
  // The Trace stamp is bookkeeping about the recording, not about the learner.
  const { trace: _stamp, ...kbForAgent } = lessonKB || {};
  const userContent = JSON.stringify({ untrustedText: LEARNER_TEXT_FRAMING, currentProfile: profileForAgent(fullProfile), lessonKB: kbForAgent, activitiesCompleted, lessonName, lessonId });
  const { content } = await callApi({
    agent: 'learner-profile-owner', purpose: 'profile update on completion', trace,
    model: LLM, parts: await agentParts('learner-profile-owner'),
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

export function incrementalProfileUpdate(profile, lessonId) {
  const updated = { ...profile };
  if (!updated.activeLessons) updated.activeLessons = [];
  if (!updated.activeLessons.includes(lessonId)) updated.activeLessons.push(lessonId);
  updated.updatedAt = Date.now();
  return updated;
}

export async function updateProfileFromFeedback(fullProfile, feedbackText, activityContext, source = 'learner', { trace } = {}) {
  // A learner note that reads as instructions never reaches the agent, whether
  // it's being added or removed (it was never shown, so there's nothing to
  // undo). The note itself is already saved; the profile is left as it was.
  const flag = source !== 'coach' ? learnerNoteFlag(feedbackText) : null;
  if (flag) { trace?.step('noteScreened', { reason: flag, source }); return null; }
  const userContent = JSON.stringify(profileUpdateInput(fullProfile, feedbackText, activityContext, source));
  const { content } = await callApi({
    agent: 'learner-profile-update', purpose: `profile update (${source})`, trace,
    model: LLM, parts: await agentParts('learner-profile-update'),
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

export async function updateCourseProgress(courseName, lessonsInCourse, priorSummary, completedLesson, completedLessonIds, { trace } = {}) {
  const userContent = JSON.stringify({
    courseName,
    lessonsInCourse,
    priorSummary: priorSummary || '',
    completedLesson,
    completedLessonIds: completedLessonIds || [],
  });
  const { content } = await callApi({
    agent: 'course-progress-update', purpose: 'unit note on completion', trace,
    model: LLM, parts: await agentParts('course-progress-update'),
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

export async function extractLessonMarkdown(conversationText, { trace } = {}) {
  const { content } = await callApi({
    agent: 'lesson-extractor', purpose: 'write the lesson from the conversation', trace,
    model: LLM, parts: await agentParts('lesson-extractor'),
    messages: [{ role: 'user', content: conversationText }], maxTokens: 1536,
  });
  return content.trim();
}

export async function extractKBMarkdown(conversationText, existingKB = '', { trace } = {}) {
  const userContent = existingKB
    ? `## EXISTING KNOWLEDGE BASE\n\n${existingKB}\n\n## CONVERSATION\n\n${conversationText}`
    : `## EXISTING KNOWLEDGE BASE\n\n(none — creating from scratch)\n\n## CONVERSATION\n\n${conversationText}`;
  const { content } = await callApi({
    agent: 'knowledge-base-extractor', purpose: 'write the knowledge base from the conversation', trace,
    model: LLM, parts: await agentParts('knowledge-base-extractor'),
    messages: [{ role: 'user', content: userContent }], maxTokens: 4096,
  });
  return content.trim();
}
