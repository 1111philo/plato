/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { parseSSEStream, parseResponse, MODEL_LIGHT, MODEL_HEAVY, ApiError } from './api.js';
import { authenticatedFetch } from './auth.js';
import { validateLessonKB } from './validators.js';

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
    if (!lessons.length) { adminCatalog = ''; return ''; }
    adminCatalog = lessons.map(l => {
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

  const RETRIES = 2;
  const DELAYS = [3000, 6000];
  let lastError;
  for (let i = 0; i <= RETRIES; i++) {
    try { return await attempt(); } catch (e) {
      lastError = e;
      const isRetryable = e.type === 'overloaded' || (e.type === 'api' && e.status === 500);
      if (!isRetryable || i === RETRIES) throw e;
      await new Promise(r => setTimeout(r, DELAYS[i]));
    }
  }
  throw lastError;
}

export function invalidateLessonCatalog() { publicCatalog = null; adminCatalog = null; }

export async function isReady() {
  return true;
}

// -- Streaming conversations --------------------------------------------------

export async function converseStream(promptName, messages, onChunk, maxTokens = 512) {
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

  const resp = await authenticatedFetch('/v1/ai/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_LIGHT, max_tokens: maxTokens, system: systemPrompt, messages, stream: true }),
  });
  const contentType = resp.headers.get('content-type') || '';
  if (resp.ok && contentType.includes('text/event-stream')) {
    let full = '';
    for await (const chunk of parseSSEStream(resp.body)) { full += chunk; onChunk(full); }
    return full;
  }
  // Non-streaming response (proxy returned JSON)
  const { content } = await parseResponse(resp);
  onChunk(content);
  return content;
}

// -- Lesson Owner (LLM) -------------------------------------------------------

export async function initializeLessonKB(lesson, profileSummary) {
  const systemPrompt = await loadPrompt('lesson-owner');
  const userContent = JSON.stringify({
    lessonId: lesson.lessonId, lessonName: lesson.name,
    lessonDescription: lesson.description, exemplar: lesson.exemplar,
    learningObjectives: lesson.learningObjectives,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
  });
  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT, systemPrompt,
      messages: [{ role: 'user', content: userContent }], maxTokens: 1536,
    });
    return parseJSON(content);
  };
  return callWithValidation(callAgent, validateLessonKB);
}

// -- Learner Profile Owner (LLM — deep update on lesson completion) -----------

export async function updateProfileOnCompletion(fullProfile, lessonKB, lessonName, lessonId, activitiesCompleted) {
  const systemPrompt = await loadPrompt('learner-profile-owner');
  const userContent = JSON.stringify({ currentProfile: fullProfile, lessonKB, activitiesCompleted, lessonName, lessonId });
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
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

export async function updateProfileFromFeedback(fullProfile, feedbackText, activityContext) {
  const systemPrompt = await loadPrompt('learner-profile-update');
  const userContent = JSON.stringify({
    currentProfile: fullProfile, learnerFeedback: feedbackText,
    context: { lessonName: activityContext.lessonName, activityType: activityContext.activityType, activityGoal: activityContext.activityGoal, timestamp: Date.now() },
  });
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

// -- Lesson markdown extraction (from conversation) ---------------------------

export async function extractLessonMarkdown(conversationText) {
  const systemPrompt = await loadPrompt('lesson-extractor');
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
    messages: [{ role: 'user', content: conversationText }], maxTokens: 1536,
  });
  return content.trim();
}

// -- Knowledge base markdown extraction (from conversation) -------------------

export async function extractKBMarkdown(conversationText, existingKB = '') {
  const systemPrompt = await loadPrompt('knowledge-base-extractor');
  const userContent = existingKB
    ? `## EXISTING KNOWLEDGE BASE\n\n${existingKB}\n\n## CONVERSATION\n\n${conversationText}`
    : `## EXISTING KNOWLEDGE BASE\n\n(none — creating from scratch)\n\n## CONVERSATION\n\n${conversationText}`;
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 4096,
  });
  return content.trim();
}
