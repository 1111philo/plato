import { Hono } from 'hono';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const content = new Hono();

/**
 * Normalize a lesson's visibility status.
 * `draft` is a first-class status for in-progress lessons that have no markdown yet.
 * Legacy records with `status: 'draft'` AND markdown present are treated as `private`.
 */
function normalizeStatus(status, hasMarkdown = true) {
  if (status === 'published' || status === 'public') return 'public';
  if (status === 'draft' && !hasMarkdown) return 'draft';
  return 'private';
}

// All content routes require authentication
content.use('/v1/prompts/*', authenticate);
content.use('/v1/lessons', authenticate);
content.use('/v1/lessons/*', authenticate);
content.use('/v1/knowledge-base', authenticate);

/**
 * Resolve the userId a learner-facing lesson read should be scoped to.
 * Admins may pass `?asUserId=<id>` to evaluate ACLs (sharedWith) as that
 * learner — this powers the "View as User" admin feature. Non-admins
 * passing the param get a 403; everyone else falls back to their own
 * JWT-derived userId.
 */
function resolveReadUserId(c) {
  const url = new URL(c.req.url);
  const asUserId = url.searchParams.get('asUserId');
  if (!asUserId) return { userId: c.get('userId') };
  if (c.get('role') !== 'admin') {
    return { error: c.json({ error: 'Admin access required to read as another user' }, 403) };
  }
  return { userId: asUserId };
}

// GET /v1/version — public
content.get('/v1/version', (c) => {
  const paths = [
    join(__dirname, '../../../version.json'),       // local dev (server/src/routes -> repo root)
    join(__dirname, '../../version.json'),           // Lambda build (src/routes -> function root)
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf-8'));
        return c.json({ version: data.version || null });
      } catch { break; }
    }
  }
  return c.json({ version: null });
});

// GET /v1/branding — public (needed for login page theming)
content.get('/v1/branding', async (c) => {
  c.header('Cache-Control', 'no-cache');
  const item = await db.getSyncData('_system', 'settings');
  const settings = item?.data || {};
  return c.json({
    theme: settings.theme || null,
    logoBase64: settings.logoBase64 || null,
    classroomName: settings.classroomName || settings.logoAlt || '',
  });
});

// GET /v1/prompts/:name — get a system prompt
content.get('/v1/prompts/:name', async (c) => {
  const name = c.req.param('name');
  const item = await db.getSyncData('_system', `prompt:${name}`);
  if (!item) return c.json({ error: 'Prompt not found' }, 404);
  return c.json({ name, content: item.data.content, updatedAt: item.updatedAt });
});

// GET /v1/lessons — list lessons the user has access to
// Public lessons visible to all; private lessons visible only to users in sharedWith.
// Drafts (admin-only work-in-progress) are never exposed to learners.
// When a lesson has a `course` field (course id), it's inlined as `{ id, name }`
// so the client can display + the coach context can reference it without a
// second fetch.
content.get('/v1/lessons', async (c) => {
  const resolved = resolveReadUserId(c);
  if (resolved.error) return resolved.error;
  const userId = resolved.userId;
  const items = await db.getAllSyncData('_system');
  const coursesById = new Map();
  for (const i of items) {
    if (!i.dataKey.startsWith('course:')) continue;
    coursesById.set(i.dataKey.slice('course:'.length), i.data || {});
  }
  const lessons = items
    .filter(i => {
      if (!i.dataKey.startsWith('lesson:')) return false;
      const status = normalizeStatus(i.data.status, !!i.data.markdown);
      if (status === 'draft') return false;
      if (status === 'public') return true;
      return Array.isArray(i.data.sharedWith) && i.data.sharedWith.includes(userId);
    })
    .map(i => {
      const { sharedWith: _sharedWith, course: courseId, ...data } = i.data;
      const courseRecord = courseId ? coursesById.get(courseId) : null;
      const course = courseRecord
        ? { id: courseId, name: courseRecord.name || courseId }
        : null;
      return {
        lessonId: i.dataKey.slice('lesson:'.length),
        ...data,
        course,
        updatedAt: i.updatedAt,
      };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  return c.json(lessons);
});

// GET /v1/lessons/time-stats — per-lesson completion-time estimates derived from
// completed lesson KBs across all users. Returns { [lessonId]: { p20, p80, sampleSize } }
// where p20/p80 are exchange counts at the 20th/80th percentile (middle 60% range).
// Lessons with fewer than 3 completions are omitted. Response is filtered to lessons
// the requesting user can see (public + private shared with them) so we don't leak
// information about lessons the user has no access to.
//
// Cache: each miss costs O(users × items-per-user) DynamoDB queries (listAllUsers
// then getAllSyncData per user — same scan pattern as /v1/admin/stats/lessons,
// but called from a learner-facing endpoint). Time stats are slow-moving — one
// additional completion barely shifts a percentile — so a long TTL is fine.
// 10 minutes keeps the scan rate at ≤6/hour per Lambda container regardless of
// learner traffic.
const TIME_STATS_TTL_MS = 10 * 60_000;
let _timeStatsCache = null; // { computedAt, byLesson }

async function computeAllLessonTimeStats() {
  if (_timeStatsCache && Date.now() - _timeStatsCache.computedAt < TIME_STATS_TTL_MS) {
    return _timeStatsCache.byLesson;
  }
  const users = await db.listAllUsers();
  const exchangesByLesson = new Map();
  for (const user of users) {
    const items = await db.getAllSyncData(user.userId);
    for (const item of items) {
      if (!item.dataKey?.startsWith('lessonKB:')) continue;
      const kb = item.data;
      if (kb?.status !== 'completed') continue;
      const exchanges = kb.activitiesCompleted;
      if (typeof exchanges !== 'number' || exchanges <= 0) continue;
      const lessonId = item.dataKey.slice('lessonKB:'.length);
      if (!exchangesByLesson.has(lessonId)) exchangesByLesson.set(lessonId, []);
      exchangesByLesson.get(lessonId).push(exchanges);
    }
  }
  const byLesson = {};
  for (const [lessonId, counts] of exchangesByLesson.entries()) {
    if (counts.length < 3) continue;
    counts.sort((a, b) => a - b);
    const p20Idx = Math.floor(counts.length * 0.2);
    const p80Idx = Math.min(Math.floor(counts.length * 0.8), counts.length - 1);
    byLesson[lessonId] = { p20: counts[p20Idx], p80: counts[p80Idx], sampleSize: counts.length };
  }
  _timeStatsCache = { computedAt: Date.now(), byLesson };
  return byLesson;
}

// Exposed for tests so the in-process cache doesn't leak between cases.
export function _resetTimeStatsCache() { _timeStatsCache = null; }

content.get('/v1/lessons/time-stats', async (c) => {
  const resolved = resolveReadUserId(c);
  if (resolved.error) return resolved.error;
  const userId = resolved.userId;
  const [systemItems, allStats] = await Promise.all([
    db.getAllSyncData('_system'),
    computeAllLessonTimeStats(),
  ]);
  const visible = new Set();
  for (const i of systemItems) {
    if (!i.dataKey?.startsWith('lesson:')) continue;
    const status = normalizeStatus(i.data.status, !!i.data.markdown);
    if (status === 'draft') continue;
    if (status === 'public' || (Array.isArray(i.data.sharedWith) && i.data.sharedWith.includes(userId))) {
      visible.add(i.dataKey.slice('lesson:'.length));
    }
  }
  const filtered = {};
  for (const [lessonId, stats] of Object.entries(allStats)) {
    if (visible.has(lessonId)) filtered[lessonId] = stats;
  }
  return c.json(filtered);
});

// GET /v1/lessons/:lessonId — get a lesson (public, or private if user is in sharedWith)
// When a lesson has a `course` field, the response inlines `course: { id, name }`.
// If the referenced course was deleted (transient drift between cascade and read), `course` is null.
content.get('/v1/lessons/:lessonId', async (c) => {
  const resolved = resolveReadUserId(c);
  if (resolved.error) return resolved.error;
  const lessonId = c.req.param('lessonId');
  const item = await db.getSyncData('_system', `lesson:${lessonId}`);
  if (!item) return c.json({ error: 'Lesson not found' }, 404);
  const status = normalizeStatus(item.data.status, !!item.data.markdown);
  if (status === 'draft') return c.json({ error: 'Lesson not found' }, 404);
  if (status !== 'public') {
    if (!Array.isArray(item.data.sharedWith) || !item.data.sharedWith.includes(resolved.userId)) {
      return c.json({ error: 'Lesson not found' }, 404);
    }
  }
  const { sharedWith: _sharedWith, course: courseId, ...data } = item.data;
  let course = null;
  if (courseId) {
    const courseItem = await db.getSyncData('_system', `course:${courseId}`);
    if (courseItem?.data) {
      course = {
        id: courseId,
        name: courseItem.data.name || courseId,
      };
    }
  }
  return c.json({ lessonId, ...data, course, updatedAt: item.updatedAt });
});

// GET /v1/knowledge-base — get the knowledge base content
content.get('/v1/knowledge-base', async (c) => {
  const item = await db.getSyncData('_system', 'knowledgeBase');
  if (!item) return c.json({ content: '' });
  return c.json({ content: item.data.content || '' });
});

export default content;
