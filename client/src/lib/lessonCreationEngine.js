/**
 * Lesson creation engine — manages the conversational flow
 * for creating a new lesson with the Lesson Creator agent.
 */

import {
  getLessonMessages, saveLessonMessages, clearLessonMessages,
  saveUserLesson, getDraftLessonId,
} from '../../js/storage.js';
import { converseStream, extractLessonMarkdown } from '../../js/orchestrator.js';
import { parseLessonPrompt, invalidateLessonsCache } from '../../js/lessonOwner.js';
import { syncInBackground } from './syncDebounce.js';
import { MSG_TYPES, MIN_OBJECTIVES, MAX_OBJECTIVES } from './constants.js';

function ts() { return Date.now(); }
const READINESS_REGEX = /\[READINESS:\s*(\d+)\]\s*$/;
const LESSON_MD_REGEX = /\[LESSON_MARKDOWN\]([\s\S]*?)\[\/LESSON_MARKDOWN\]/;

/** Strip the readiness tag from a response and return { text, readiness }. */
export function parseResponse(raw) {
  const match = raw.match(READINESS_REGEX);
  const readiness = match ? parseInt(match[1], 10) : null;
  const text = stripReadiness(raw);
  return { text, readiness };
}

/** Strip any readiness tag from text. */
function stripReadiness(text) {
  return text.replace(READINESS_REGEX, '').trim();
}

/** Wrap a stream callback to strip the readiness tag from partial text. */
export function cleanStream(onStream) {
  if (!onStream) return () => {};
  return (partial) => onStream(stripReadiness(partial));
}

/**
 * Start a new lesson creation conversation.
 * Returns { messages, draftId, readiness }.
 */
export async function startCreation(onStream) {
  const draftId = `create:draft-${ts()}`;

  const agentMsg = await converseStream(
    'lesson-creator',
    [{ role: 'user', content: 'I want to create a new lesson.' }],
    cleanStream(onStream),
    512
  );

  const { text, readiness } = parseResponse(agentMsg);

  const messages = [
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: 'creating', timestamp: ts() },
  ];

  await saveLessonMessages(draftId, messages);
  syncInBackground(`messages:${draftId}`);
  return { messages, draftId, readiness: readiness ?? 1 };
}

/**
 * Send a user message in the creation conversation.
 * Returns { messages, readiness }.
 */
export async function sendMessage(draftId, userText, onStream) {
  const allMsgs = await getLessonMessages(draftId);

  // Build conversation tail (last 15 messages for context)
  const tail = allMsgs.slice(-15).map(m => ({ role: m.role, content: m.content }));
  tail.push({ role: 'user', content: userText });

  const agentMsg = await converseStream(
    'lesson-creator',
    tail,
    cleanStream(onStream),
    512
  );

  const { text, readiness } = parseResponse(agentMsg);

  const newMessages = [
    { role: 'user', content: userText, msgType: MSG_TYPES.USER, phase: 'creating', timestamp: ts() },
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: 'creating', timestamp: ts() },
  ];

  await saveLessonMessages(draftId, newMessages);
  syncInBackground(`messages:${draftId}`);
  return { messages: newMessages, readiness: readiness ?? null };
}

/**
 * Generate and save the lesson. Asks the agent to produce the final markdown.
 * Returns { lessonId, lesson } on success, or { error } on failure.
 */
export async function createLesson(draftId) {
  const allMsgs = await getLessonMessages(draftId);

  // Build conversation transcript for the extraction agent
  const conversationText = allMsgs.map(m => {
    const role = m.role === 'user' ? 'User' : 'Agent';
    return `${role}: ${m.content}`;
  }).join('\n\n');

  // One-shot extraction: conversation → lesson markdown
  const markdown = await extractLessonMarkdown(conversationText);

  const lessonId = `custom-${ts()}`;
  const lesson = parseLessonPrompt(lessonId, markdown);

  if (!lesson.name || !lesson.exemplar || !lesson.learningObjectives.length) {
    return { error: 'Could not build a complete lesson from the conversation. Keep refining with the agent.' };
  }
  if (lesson.learningObjectives.length < MIN_OBJECTIVES) {
    return { error: `Too few objectives (${lesson.learningObjectives.length}). Lessons need at least ${MIN_OBJECTIVES} learning objectives.` };
  }
  if (lesson.learningObjectives.length > MAX_OBJECTIVES) {
    return { error: `Too many objectives (${lesson.learningObjectives.length}). Microlearning lessons need ${MIN_OBJECTIVES}-${MAX_OBJECTIVES} objectives to fit in under 20 minutes.` };
  }

  await saveUserLesson(lessonId, markdown);
  invalidateLessonsCache();
  syncInBackground(`lessons:${lessonId}`);

  return { lessonId, lesson };
}

/**
 * Resume an existing draft. Loads messages and extracts readiness.
 * Returns { messages, draftId, readiness }.
 */
export async function resumeDraft(draftId) {
  const rawMessages = await getLessonMessages(draftId);

  // Strip any readiness tags from stored messages (may exist from older sessions)
  // and extract the latest readiness value
  let readiness = 1;
  const messages = rawMessages.map(m => {
    if (m.role === 'assistant') {
      const match = m.content.match(READINESS_REGEX);
      if (match) readiness = parseInt(match[1], 10);
      return { ...m, content: stripReadiness(m.content) };
    }
    return m;
  });

  // Fallback if no readiness found: estimate from conversation length
  if (readiness === 1 && messages.length > 4) {
    readiness = Math.min(Math.floor(messages.length / 3), 6);
  }

  return { messages, draftId, readiness };
}

/**
 * Delete a draft and its conversation.
 */
export async function deleteDraft(draftId) {
  await clearLessonMessages(draftId);
}

/**
 * Check if a draft exists.
 */
export { getDraftLessonId } from '../../js/storage.js';
