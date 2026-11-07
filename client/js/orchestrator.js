/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { parseSSEStream, parseResponse, LLM, ApiError, backoffMs, isRetryable } from './api.js';
import { authenticatedFetch } from './auth.js';
import { validateLessonKB } from './validators.js';
import { withLanguage } from './language.js';

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

let publicCatalog = null;
let adminCatalog = null;

async function loadPublicCatalog() {
  if (publicCatalog) return publicCatalog;
  try {
    const resp = await authenticatedFetch('/v1/lessons');
    const lessons = resp.ok ? await resp.json() : [];
    if (!lessons.length) { publicCatalog = ''; return ''; }
    publicCatalog = lessons.map(l => `- ${l.name || l.lessonId}`).join('\n');
  } catch { publicCatalog = ''; }
  return publicCatalog;
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

async function callWithValidation(agentFn, validator) {
  const parsed = await agentFn();
  const error = validator(parsed);
  if (!error) return parsed;
  console.error(`[plato] Validation failed (retrying): ${error}`);
  const retry = await agentFn();
  const retryError = validator(retry);
  if (retryError) {
    console.error(`[plato] Validation failed after retry: ${retryError}`);
    if (retryError.includes('unsafe')) throw new ApiError('safety', retryError);
  }
  return retry;
}

async function callApi({ model, systemPrompt, messages, maxTokens = 1024 }) {
  const attempt = async () => {
    const resp = await authenticatedFetch('/v1/ai/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages }),
    });
    return parseResponse(resp);
  };

  // Busy, rate-limited, timed out, or a 5xx: wait (the server's retryAfterMs,
  // else exponential) with jitter, so a cohort that failed together doesn't
  // retry together.
  const RETRIES = 2;
  let lastError;
  for (let i = 0; i <= RETRIES; i++) {
    try { return await attempt(); } catch (e) {
      lastError = e;
      if (!isRetryable(e) || i === RETRIES) throw e;
      await new Promise(r => setTimeout(r, backoffMs(i, e.retryAfterMs)));
    }
  }
  throw lastError;
}

export function invalidateLessonCatalog() { publicCatalog = null; adminCatalog = null; }

export async function isReady() {
  return true;
}

// -- Streaming conversations --------------------------------------------------

/**
 * An agent's full system prompt: its prompt file, plus the program knowledge
 * base and lesson catalog for the agents that get them, plus `addendum`, in
 * the learner's language (#240). Shared by the streamed call and the coach's
 * tag repair, so a repair is judged under the same prompt as the reply.
 */
async function buildSystemPrompt(promptName, addendum = '') {
  let systemPrompt = await loadPrompt(promptName);
  if (KB_AGENTS.includes(promptName)) {
    const kb = await loadKnowledgeBase();
    if (kb) systemPrompt = `${systemPrompt}\n\n---\n\n## Program Knowledge Base\n\n${kb}`;
  }
  if (ADMIN_CATALOG_AGENTS.includes(promptName)) {
    const catalog = await loadAdminCatalog();
    if (catalog) systemPrompt = `${systemPrompt}\n\n---\n\n## Current Lessons in This Classroom\n\n${catalog}`;
  } else if (PUBLIC_CATALOG_AGENTS.includes(promptName)) {
    const catalog = await loadPublicCatalog();
    if (catalog) systemPrompt = `${systemPrompt}\n\n---\n\n## Lessons in This Classroom\n\n${catalog}`;
  }
  if (addendum) systemPrompt = `${systemPrompt}\n\n---\n\n${addendum}`;
  // The learner's language, if not English (#240) — see language.js.
  return withLanguage(systemPrompt);
}

export async function converseStream(promptName, messages, onChunk, maxTokens = 512) {
  const systemPrompt = await buildSystemPrompt(promptName);

  const send = () => authenticatedFetch('/v1/ai/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM, max_tokens: maxTokens, system: systemPrompt, messages, stream: true }),
  });
  let resp = await send();
  // Busy before anything streamed (the server waits for the first chunk
  // before answering): one jittered retry, then the typed error.
  if (resp.status === 429 || resp.status === 503) {
    const body = await resp.clone().json().catch(() => ({}));
    if (body?.code !== 'rate_limited') {
      await new Promise((r) => setTimeout(r, backoffMs(0, Number(body?.retryAfterMs) || undefined)));
      resp = await send();
    }
  }
  const contentType = resp.headers.get('content-type') || '';
  if (resp.ok && contentType.includes('text/event-stream')) {
    let full = '';
    for await (const chunk of parseSSEStream(resp.body, undefined, { failOnTruncation: promptName === 'coach' })) { full += chunk; onChunk(full); }
    return full;
  }
  // Non-streaming response (proxy returned JSON)
  const { content } = await parseResponse(resp);
  onChunk(content);
  return content;
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
export async function repairCoachTags(messages, reply) {
  const systemPrompt = await buildSystemPrompt('coach', `## Tag repair (from plato, not the learner)\n\nYour last reply in this conversation ended without all of its tags. The final user message ("${TAG_REPAIR_CUE}") comes from plato, not the learner. Reply with ONLY the tag lines for your last reply: [PROGRESS: N], [KB_UPDATE: {...}], and [PROFILE_UPDATE: {...}] if it applies. Score what the learner has actually shown, consistent with what your last reply told them. No other text.`);
  const { content } = await callApi({
    model: LLM, systemPrompt,
    messages: [...messages, { role: 'assistant', content: reply }, { role: 'user', content: TAG_REPAIR_CUE }],
    maxTokens: 600,
  });
  return content;
}

// -- Lesson Owner (LLM) -------------------------------------------------------

export async function initializeLessonKB(lesson, profileSummary) {
  let systemPrompt = await loadPrompt('lesson-owner');
  systemPrompt = withLanguage(systemPrompt);
  const userContent = JSON.stringify({
    lessonId: lesson.lessonId, lessonName: lesson.name,
    lessonDescription: lesson.description, exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
  });
  const callAgent = async () => {
    const { content } = await callApi({
      model: LLM, systemPrompt,
      messages: [{ role: 'user', content: userContent }], maxTokens: 1536,
    });
    return parseJSON(content);
  };
  return callWithValidation(callAgent, validateLessonKB);
}

// The profile-update agents only revise the "soft" fields (name, goal,
// strengths, weaknesses, preferences, summary). `masteredLessons`/
// `activeLessons` are system-managed bookkeeping arrays that grow without
// bound as a learner progresses; `mergeProfile` always reunions them from the
// stored profile, so the agent's copy is discarded anyway. Round-tripping them
// through the model wasted input tokens and — worse — inflated the agent's JSON
// output until it overran `max_tokens` and came back truncated/unparseable
// (issue #228 console: "max_tokens reached" → "Failed to parse agent JSON").
// Strip them before the call so the agent's output stays small and bounded.
// `learnerNotes` (the learner's own corrections, #451 testing) stays in: the
// agents must keep the profile consistent with it. mergeProfile ignores any
// copy they send back.
export function profileForAgent(profile) {
  const { masteredLessons: _m, activeLessons: _a, ...rest } = profile || {};
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
    currentProfile: profileForAgent(fullProfile),
    source,
    // 'learner-removed': the learner deleted a note; it's what no longer applies, not new feedback.
    ...(source === 'coach' ? { coachObservation: text } : source === 'learner-removed' ? { removedNote: text } : { learnerFeedback: text }),
    context: { lessonName: activityContext.lessonName, activityType: activityContext.activityType, activityGoal: activityContext.activityGoal, timestamp: now },
  };
}

// -- Learner Profile Owner (LLM — deep update on lesson completion) -----------

export async function updateProfileOnCompletion(fullProfile, lessonKB, lessonName, lessonId, activitiesCompleted) {
  let systemPrompt = await loadPrompt('learner-profile-owner');
  systemPrompt = withLanguage(systemPrompt);
  const userContent = JSON.stringify({ currentProfile: profileForAgent(fullProfile), lessonKB, activitiesCompleted, lessonName, lessonId });
  const { content } = await callApi({
    model: LLM, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

// -- Learner Profile Owner (code — incremental merge) -------------------------

export function incrementalProfileUpdate(profile, lessonId) {
  const updated = { ...profile };
  if (!updated.activeLessons) updated.activeLessons = [];
  if (!updated.activeLessons.includes(lessonId)) updated.activeLessons.push(lessonId);
  updated.updatedAt = Date.now();
  return updated;
}

// -- Profile feedback (LLM) --------------------------------------------------

export async function updateProfileFromFeedback(fullProfile, feedbackText, activityContext, source = 'learner') {
  let systemPrompt = await loadPrompt('learner-profile-update');
  systemPrompt = withLanguage(systemPrompt);
  const userContent = JSON.stringify(profileUpdateInput(fullProfile, feedbackText, activityContext, source));
  const { content } = await callApi({
    model: LLM, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

// -- Course Progress Updater (LLM — distill cross-lesson progress) ------------

export async function updateCourseProgress(courseName, lessonsInCourse, priorSummary, completedLesson, completedLessonIds) {
  let systemPrompt = await loadPrompt('course-progress-update');
  systemPrompt = withLanguage(systemPrompt);
  const userContent = JSON.stringify({
    courseName,
    lessonsInCourse,
    priorSummary: priorSummary || '',
    completedLesson,
    completedLessonIds: completedLessonIds || [],
  });
  const { content } = await callApi({
    model: LLM, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

// -- Lesson markdown extraction (from conversation) ---------------------------

export async function extractLessonMarkdown(conversationText) {
  let systemPrompt = await loadPrompt('lesson-extractor');
  systemPrompt = withLanguage(systemPrompt);
  const { content } = await callApi({
    model: LLM, systemPrompt,
    messages: [{ role: 'user', content: conversationText }], maxTokens: 1536,
  });
  return content.trim();
}

// -- Knowledge base markdown extraction (from conversation) -------------------

export async function extractKBMarkdown(conversationText, existingKB = '') {
  let systemPrompt = await loadPrompt('knowledge-base-extractor');
  systemPrompt = withLanguage(systemPrompt);
  const userContent = existingKB
    ? `## EXISTING KNOWLEDGE BASE\n\n${existingKB}\n\n## CONVERSATION\n\n${conversationText}`
    : `## EXISTING KNOWLEDGE BASE\n\n(none — creating from scratch)\n\n## CONVERSATION\n\n${conversationText}`;
  const { content } = await callApi({
    model: LLM, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 4096,
  });
  return content.trim();
}
