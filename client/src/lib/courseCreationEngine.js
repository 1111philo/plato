/**
 * Course creation engine — manages the conversational flow
 * for creating a new course with the Course Creator agent.
 */

import {
  getCourseMessages, saveCourseMessages, clearCourseMessages,
  saveUserCourse, getDraftCourseId,
} from '../../js/storage.js';
import { converseStream, extractCourseMarkdown } from '../../js/orchestrator.js';
import { parseCoursePrompt, invalidateCoursesCache } from '../../js/courseOwner.js';
import { syncInBackground } from './syncDebounce.js';
import { MSG_TYPES } from './constants.js';

function ts() { return Date.now(); }

const READINESS_REGEX = /\[READINESS:\s*(\d+)\]\s*$/;
const COURSE_MD_REGEX = /\[COURSE_MARKDOWN\]([\s\S]*?)\[\/COURSE_MARKDOWN\]/;

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
 * Start a new course creation conversation.
 * Returns { messages, draftId, readiness }.
 */
export async function startCreation(onStream) {
  const draftId = `create:draft-${ts()}`;

  const agentMsg = await converseStream(
    'course-creator',
    [{ role: 'user', content: 'I want to create a new course.' }],
    cleanStream(onStream),
    512
  );

  const { text, readiness } = parseResponse(agentMsg);

  const messages = [
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: 'creating', timestamp: ts() },
  ];

  await saveCourseMessages(draftId, messages);
  syncInBackground(`messages:${draftId}`);
  return { messages, draftId, readiness: readiness ?? 1 };
}

/**
 * Send a user message in the creation conversation.
 * Returns { messages, readiness }.
 */
export async function sendMessage(draftId, userText, onStream) {
  const allMsgs = await getCourseMessages(draftId);

  // Build conversation tail (last 15 messages for context)
  const tail = allMsgs.slice(-15).map(m => ({ role: m.role, content: m.content }));
  tail.push({ role: 'user', content: userText });

  const agentMsg = await converseStream(
    'course-creator',
    tail,
    cleanStream(onStream),
    512
  );

  const { text, readiness } = parseResponse(agentMsg);

  const newMessages = [
    { role: 'user', content: userText, msgType: MSG_TYPES.USER, phase: 'creating', timestamp: ts() },
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: 'creating', timestamp: ts() },
  ];

  await saveCourseMessages(draftId, newMessages);
  syncInBackground(`messages:${draftId}`);
  return { messages: newMessages, readiness: readiness ?? null };
}

/**
 * Generate and save the course. Asks the agent to produce the final markdown.
 * Returns { courseId, course } on success, or { error } on failure.
 */
export async function createCourse(draftId) {
  const allMsgs = await getCourseMessages(draftId);

  // Build conversation transcript for the extraction agent
  const conversationText = allMsgs.map(m => {
    const role = m.role === 'user' ? 'User' : 'Agent';
    return `${role}: ${m.content}`;
  }).join('\n\n');

  // One-shot extraction: conversation → course markdown
  const markdown = await extractCourseMarkdown(conversationText);

  const courseId = `custom-${ts()}`;
  const course = parseCoursePrompt(courseId, markdown);

  if (!course.name || !course.exemplar || !course.learningObjectives.length) {
    return { error: 'Could not build a complete course from the conversation. Keep refining with the agent.' };
  }

  await saveUserCourse(courseId, markdown);
  invalidateCoursesCache();
  syncInBackground(`courses:${courseId}`);

  return { courseId, course };
}

/**
 * Resume an existing draft. Loads messages and extracts readiness.
 * Returns { messages, draftId, readiness }.
 */
export async function resumeDraft(draftId) {
  const rawMessages = await getCourseMessages(draftId);

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
  await clearCourseMessages(draftId);
}

/**
 * Check if a draft exists.
 */
export { getDraftCourseId } from '../../js/storage.js';
