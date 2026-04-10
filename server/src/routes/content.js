import { Hono } from 'hono';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const content = new Hono();

/** Map legacy statuses to public/private. */
function normalizeStatus(status) {
  if (status === 'published' || status === 'public') return 'public';
  return 'private'; // draft, private, undefined → private
}

// All content routes require authentication
content.use('/v1/prompts/*', authenticate);
content.use('/v1/lessons', authenticate);
content.use('/v1/lessons/*', authenticate);
content.use('/v1/knowledge-base', authenticate);

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
// Public lessons visible to all; private lessons visible only to users in sharedWith
content.get('/v1/lessons', async (c) => {
  const userId = c.get('userId');
  const items = await db.getAllSyncData('_system');
  const lessons = items
    .filter(i => {
      if (!i.dataKey.startsWith('lesson:')) return false;
      // Treat legacy 'draft' and 'published' as 'private' and 'public' respectively
      const status = normalizeStatus(i.data.status);
      if (status === 'public') return true;
      // Private lessons: only visible if user is in sharedWith
      return Array.isArray(i.data.sharedWith) && i.data.sharedWith.includes(userId);
    })
    .map(i => {
      const { sharedWith, ...data } = i.data;
      return {
        lessonId: i.dataKey.slice('lesson:'.length),
        ...data,
        updatedAt: i.updatedAt,
      };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  return c.json(lessons);
});

// GET /v1/lessons/:lessonId — get a lesson (public, or private if user is in sharedWith)
content.get('/v1/lessons/:lessonId', async (c) => {
  const lessonId = c.req.param('lessonId');
  const item = await db.getSyncData('_system', `lesson:${lessonId}`);
  if (!item) return c.json({ error: 'Lesson not found' }, 404);
  const status = normalizeStatus(item.data.status);
  if (status !== 'public') {
    const userId = c.get('userId');
    if (!Array.isArray(item.data.sharedWith) || !item.data.sharedWith.includes(userId)) {
      return c.json({ error: 'Lesson not found' }, 404);
    }
  }
  const { sharedWith, ...data } = item.data;
  return c.json({ lessonId, ...data, updatedAt: item.updatedAt });
});

// GET /v1/knowledge-base — get the knowledge base content
content.get('/v1/knowledge-base', async (c) => {
  const item = await db.getSyncData('_system', 'knowledgeBase');
  if (!item) return c.json({ content: '' });
  return c.json({ content: item.data.content || '' });
});

export default content;
