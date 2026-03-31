/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { parseSSEStream, parseResponse, MODEL_LIGHT, MODEL_HEAVY, ApiError } from './api.js';
import { authenticatedFetch } from './auth.js';
import { validateCourseKB } from './validators.js';
import { resolveAssetURL } from './platform.js';

const promptCache = {};
let knowledgeBase = null;

async function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const url = resolveAssetURL(`prompts/${name}.md`);
  const resp = await fetch(url);
  const text = await resp.text();
  promptCache[name] = text;
  return text;
}

async function loadKnowledgeBase() {
  if (knowledgeBase) return knowledgeBase;
  try {
    const url = resolveAssetURL('data/knowledge-base.md');
    const resp = await fetch(url);
    knowledgeBase = await resp.text();
  } catch {
    knowledgeBase = '';
  }
  return knowledgeBase;
}

const KB_AGENTS = ['coach', 'course-creator'];

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
  console.error(`[1111] Validation failed (retrying): ${error}`);
  const retry = await agentFn();
  const retryError = validator(retry);
  if (retryError) {
    console.error(`[1111] Validation failed after retry: ${retryError}`);
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

// -- Course Owner (LLM) -------------------------------------------------------

export async function initializeCourseKB(course, profileSummary) {
  const systemPrompt = await loadPrompt('course-owner');
  const userContent = JSON.stringify({
    courseId: course.courseId, courseName: course.name,
    courseDescription: course.description, exemplar: course.exemplar,
    learningObjectives: course.learningObjectives,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
  });
  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT, systemPrompt,
      messages: [{ role: 'user', content: userContent }], maxTokens: 1536,
    });
    return parseJSON(content);
  };
  return callWithValidation(callAgent, validateCourseKB);
}

// -- Learner Profile Owner (LLM — deep update on course completion) -----------

export async function updateProfileOnCompletion(fullProfile, courseKB, courseName, courseId, activitiesCompleted) {
  const systemPrompt = await loadPrompt('learner-profile-owner');
  const userContent = JSON.stringify({ currentProfile: fullProfile, courseKB, activitiesCompleted, courseName, courseId });
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

// -- Learner Profile Owner (code — incremental merge) -------------------------

export function incrementalProfileUpdate(profile, courseId) {
  const updated = { ...profile };
  if (!updated.activeCourses) updated.activeCourses = [];
  if (!updated.activeCourses.includes(courseId)) updated.activeCourses.push(courseId);
  updated.updatedAt = Date.now();
  return updated;
}

// -- Profile feedback (LLM) --------------------------------------------------

export async function updateProfileFromFeedback(fullProfile, feedbackText, activityContext) {
  const systemPrompt = await loadPrompt('learner-profile-update');
  const userContent = JSON.stringify({
    currentProfile: fullProfile, learnerFeedback: feedbackText,
    context: { courseName: activityContext.courseName, activityType: activityContext.activityType, activityGoal: activityContext.activityGoal, timestamp: Date.now() },
  });
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
    messages: [{ role: 'user', content: userContent }], maxTokens: 1024,
  });
  return parseJSON(content);
}

// -- Course markdown extraction (from conversation) ---------------------------

export async function extractCourseMarkdown(conversationText) {
  const systemPrompt = await loadPrompt('course-extractor');
  const { content } = await callApi({
    model: MODEL_LIGHT, systemPrompt,
    messages: [{ role: 'user', content: conversationText }], maxTokens: 1536,
  });
  return content.trim();
}
