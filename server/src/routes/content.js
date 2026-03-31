import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';

const content = new Hono();

// All content routes require authentication
content.use('/v1/prompts/*', authenticate);
content.use('/v1/courses', authenticate);
content.use('/v1/courses/*', authenticate);
content.use('/v1/knowledge-base', authenticate);

// GET /v1/branding — public (needed for login page theming)
content.get('/v1/branding', async (c) => {
  c.header('Cache-Control', 'no-cache');
  const item = await db.getSyncData('_system', 'settings');
  const settings = item?.data || {};
  return c.json({
    theme: settings.theme || null,
    logoBase64: settings.logoBase64 || null,
    logoAlt: settings.logoAlt || 'plato',
  });
});

// GET /v1/prompts/:name — get a system prompt
content.get('/v1/prompts/:name', async (c) => {
  const name = c.req.param('name');
  const item = await db.getSyncData('_system', `prompt:${name}`);
  if (!item) return c.json({ error: 'Prompt not found' }, 404);
  return c.json({ name, content: item.data.content, updatedAt: item.updatedAt });
});

// GET /v1/courses — list all courses
content.get('/v1/courses', async (c) => {
  const items = await db.getAllSyncData('_system');
  const courses = items
    .filter(i => i.dataKey.startsWith('course:'))
    .map(i => ({
      courseId: i.dataKey.slice('course:'.length),
      ...i.data,
      updatedAt: i.updatedAt,
    }));
  return c.json(courses);
});

// GET /v1/courses/:courseId — get a course
content.get('/v1/courses/:courseId', async (c) => {
  const courseId = c.req.param('courseId');
  const item = await db.getSyncData('_system', `course:${courseId}`);
  if (!item) return c.json({ error: 'Course not found' }, 404);
  return c.json({ courseId, ...item.data, updatedAt: item.updatedAt });
});

// GET /v1/knowledge-base — get the knowledge base content
content.get('/v1/knowledge-base', async (c) => {
  const item = await db.getSyncData('_system', 'knowledgeBase');
  if (!item) return c.json({ content: '' });
  return c.json({ content: item.data.content || '' });
});

export default content;
