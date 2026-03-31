/**
 * Course engine — conversational coaching toward the exemplar.
 *
 * 1. Course starts: Course Owner generates KB, Coach opens conversation
 * 2. Learner responds (text or image)
 * 3. Coach evaluates, coaches forward, updates KB + progress
 * 4. Repeat until exemplar achieved
 */

import {
  getLearnerProfileSummary, getPreferences,
  getCourseKB, saveCourseKB,
  saveScreenshot,
  saveCourseMessages, getCourseMessages,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';
import { ensureProfileExists, updateProfileInBackground, updateProfileOnCompletionInBackground, updateProfileFromObservation } from './profileQueue.js';
import { COURSE_PHASES, MSG_TYPES } from './constants.js';

function ts() { return Date.now(); }

const MAX_EXCHANGES = 40;

// -- Tag parsing --------------------------------------------------------------

const PROGRESS_REGEX = /\[PROGRESS:\s*(\d+)\]\s*/g;
const KB_UPDATE_REGEX = /\[KB_UPDATE:\s*(\{[\s\S]*?\})\]\s*/g;
const PROFILE_UPDATE_REGEX = /\[PROFILE_UPDATE:\s*(\{[\s\S]*?\})\]\s*/g;

function parseCoachResponse(raw) {
  let progress = null;
  let kbUpdate = null;
  let profileUpdate = null;

  // Extract progress
  const progressMatch = raw.match(/\[PROGRESS:\s*(\d+)\]/);
  if (progressMatch) progress = parseInt(progressMatch[1], 10);

  // Extract KB update
  const kbMatch = raw.match(/\[KB_UPDATE:\s*(\{[\s\S]*?\})\]/);
  if (kbMatch) {
    try { kbUpdate = JSON.parse(kbMatch[1]); } catch { /* ignore */ }
  }

  // Extract profile update
  const profileMatch = raw.match(/\[PROFILE_UPDATE:\s*(\{[\s\S]*?\})\]/);
  if (profileMatch) {
    try { profileUpdate = JSON.parse(profileMatch[1]); } catch { /* ignore */ }
  }

  // Strip all tags from display text
  const text = raw
    .replace(PROGRESS_REGEX, '')
    .replace(KB_UPDATE_REGEX, '')
    .replace(PROFILE_UPDATE_REGEX, '')
    .trim();

  return { text, progress, kbUpdate, profileUpdate };
}

/** Wrap a stream callback to strip tags from partial text. */
function cleanStream(onStream) {
  if (!onStream) return () => {};
  return (partial) => {
    const cleaned = partial
      .replace(PROGRESS_REGEX, '')
      .replace(KB_UPDATE_REGEX, '')
      .replace(PROFILE_UPDATE_REGEX, '')
      .trim();
    onStream(cleaned);
  };
}

// -- Course lifecycle ---------------------------------------------------------

/**
 * Start a new course: Course Owner generates KB, Coach opens conversation.
 */
export async function startCourse(courseId, course, onStream) {
  await ensureProfileExists();
  const profileSummary = await getLearnerProfileSummary();

  // Course Owner generates the KB
  const courseKB = await orchestrator.initializeCourseKB(course, profileSummary);
  courseKB.courseId = courseId;
  courseKB.name = course.name;
  courseKB.progress = 0;
  await saveCourseKB(courseId, courseKB);
  syncInBackground(`courseKB:${courseId}`);

  // Coach opens the conversation
  const prefs = await getPreferences();
  const context = buildContext(course, courseKB, profileSummary, prefs.name);
  const coachMsg = await orchestrator.converseStream(
    'coach',
    [{ role: 'user', content: context }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: 'Start the course.' }],
    cleanStream(onStream),
    512
  );

  const { text, progress, kbUpdate } = parseCoachResponse(coachMsg);

  if (progress != null) {
    courseKB.progress = progress;
    await saveCourseKB(courseId, courseKB);
  }

  const messages = [
    { role: 'assistant', content: text, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.LEARNING, timestamp: ts() },
  ];

  await saveCourseMessages(courseId, messages);
  syncInBackground(`courseKB:${courseId}`, `messages:${courseId}`);
  return { messages, courseKB, phase: COURSE_PHASES.LEARNING };
}

/**
 * Send a message in the course conversation.
 */
export async function sendMessage(courseId, course, text, imageDataUrl, onStream) {
  let courseKB = await getCourseKB(courseId);
  const profileSummary = await getLearnerProfileSummary();

  // Save image if provided
  let imageKey = null;
  if (imageDataUrl) {
    imageKey = `course-${courseId}-${ts()}`;
    await saveScreenshot(imageKey, imageDataUrl);
  }

  // Build conversation tail (filter out empty content — e.g. image-only messages)
  const allMsgs = await getCourseMessages(courseId);
  const tail = allMsgs.slice(-15)
    .map(m => ({ role: m.role, content: m.content }))
    .filter(m => m.content && m.content.length > 0);

  // Build user message content
  const userParts = [];
  if (text) userParts.push({ type: 'text', text });
  if (imageDataUrl) {
    const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      userParts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
  }

  // Always include context as first message so coach has course + profile info
  const prefs = await getPreferences();
  const contextMsg = buildContext(course, courseKB, profileSummary, prefs.name);
  const messages = [{ role: 'user', content: contextMsg }, { role: 'assistant', content: 'Ready.' }, ...tail];
  messages.push({ role: 'user', content: userParts.length === 1 && !imageDataUrl ? text : userParts });

  const coachMsg = await orchestrator.converseStream(
    'coach',
    messages,
    cleanStream(onStream),
    512
  );

  const parsed = parseCoachResponse(coachMsg);

  // Update course KB
  if (parsed.kbUpdate) {
    if (parsed.kbUpdate.insights?.length) {
      courseKB.insights = [...(courseKB.insights || []), ...parsed.kbUpdate.insights];
      // Prune old insights (keep last 10)
      if (courseKB.insights.length > 10) {
        const older = courseKB.insights.slice(0, courseKB.insights.length - 10);
        courseKB.insights = [`[Earlier: ${older.join('; ')}]`, ...courseKB.insights.slice(-10)];
      }
    }
    if (parsed.kbUpdate.learnerPosition) {
      courseKB.learnerPosition = parsed.kbUpdate.learnerPosition;
    }
  }
  if (parsed.progress != null) {
    courseKB.progress = parsed.progress;
  }
  courseKB.activitiesCompleted = (courseKB.activitiesCompleted || 0) + 1;

  // Check completion
  const achieved = parsed.progress >= 10 || courseKB.activitiesCompleted >= MAX_EXCHANGES;
  if (achieved) {
    courseKB.status = 'completed';
  }

  await saveCourseKB(courseId, courseKB);
  syncInBackground(`courseKB:${courseId}`);

  // Profile updates — from explicit tag or from KB insights as fallback
  if (parsed.profileUpdate?.observation) {
    updateProfileFromObservation(courseKB, parsed.profileUpdate.observation);
  } else if (parsed.kbUpdate?.insights?.length) {
    // Use KB insights as a profile signal if no explicit profile update
    const insightText = parsed.kbUpdate.insights.join('. ');
    updateProfileFromObservation(courseKB, insightText);
  }
  if (achieved) {
    updateProfileOnCompletionInBackground(courseKB, course);
  }

  // Save messages (append to existing history)
  const newMessages = [
    { role: 'user', content: text || (imageKey ? '[image]' : ''), msgType: MSG_TYPES.USER, phase: COURSE_PHASES.LEARNING,
      metadata: imageKey ? { imageKey } : null, timestamp: ts() },
    { role: 'assistant', content: parsed.text, msgType: MSG_TYPES.GUIDE,
      phase: achieved ? COURSE_PHASES.COMPLETED : COURSE_PHASES.LEARNING, timestamp: ts() },
  ];

  await saveCourseMessages(courseId, [...allMsgs, ...newMessages]);
  syncInBackground(`messages:${courseId}`);

  return { messages: newMessages, progress: parsed.progress, achieved, phase: achieved ? COURSE_PHASES.COMPLETED : COURSE_PHASES.LEARNING };
}

/**
 * Resume an existing course. Loads messages and KB.
 */
export async function resumeCourse(courseId) {
  const messages = await getCourseMessages(courseId);
  const courseKB = await getCourseKB(courseId);
  const progress = courseKB?.progress ?? 0;
  const phase = courseKB?.status === 'completed' ? COURSE_PHASES.COMPLETED : COURSE_PHASES.LEARNING;
  return { messages, courseKB, progress, phase };
}

// -- Helpers ------------------------------------------------------------------

function buildContext(course, courseKB, profileSummary, learnerName) {
  return JSON.stringify({
    learnerName: learnerName || '',
    courseName: course.name,
    courseDescription: course.description,
    exemplar: course.exemplar,
    objectives: courseKB?.objectives || [],
    insights: courseKB?.insights || [],
    learnerProfile: profileSummary || 'No profile yet',
    learnerPosition: courseKB?.learnerPosition || 'New learner',
    progress: courseKB?.progress ?? 0,
    activitiesCompleted: courseKB?.activitiesCompleted || 0,
  });
}
