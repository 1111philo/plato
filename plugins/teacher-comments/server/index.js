/**
 * Teacher Comments — server side.
 *
 * Stores admin notes about each learner. Mounted at /v1/plugins/teacher-comments/.
 *
 * Storage: per-user `userMeta:teacher-comments` records via the plugin SDK's
 * getUserMeta/putUserMeta helpers. Each comment is its own DB record keyed by
 * userId — write contention is per-user (not per-plugin), and a user-delete
 * cascade auto-cleans the comment.
 */

import {
  Hono,
  db,
  authenticate,
  requireAdmin,
  getUserMeta,
  putUserMeta,
  deleteUserMeta,
} from '../../../server/src/lib/plugins/sdk.js';

const PLUGIN_ID = 'teacher-comments';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

// GET /admin/comments — full map (for the settings panel). Reads each user's
// userMeta:teacher-comments record and assembles the map. O(N) for N users;
// fine for classroom-scale, would want indexing for larger deployments.
routes.get('/admin/comments', async (c) => {
  const users = await db.listAllUsers();
  const out = {};
  await Promise.all(users.map(async (u) => {
    const meta = await getUserMeta(u.userId, PLUGIN_ID);
    if (meta?.text) out[u.userId] = meta;
  }));
  return c.json(out);
});

// GET /admin/comments/:userId — single comment.
routes.get('/admin/comments/:userId', async (c) => {
  const userId = c.req.param('userId');
  const meta = await getUserMeta(userId, PLUGIN_ID);
  return c.json(meta || { text: '' });
});

// PUT /admin/comments/:userId — upsert. Body: { text: string }. Empty deletes.
routes.put('/admin/comments/:userId', async (c) => {
  const userId = c.req.param('userId');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required' }, 400); }
  if (typeof body?.text !== 'string') return c.json({ error: 'text (string) required' }, 400);
  if (body.text.length > 4000) return c.json({ error: 'text must be ≤ 4000 chars' }, 400);

  const adminUser = c.get('user');
  const text = body.text.trim();

  if (text === '') {
    await deleteUserMeta(userId, PLUGIN_ID);
    return c.json({ text: '' });
  }
  const next = { text, updatedAt: new Date().toISOString(), updatedBy: adminUser.userId };
  await putUserMeta(userId, PLUGIN_ID, next);
  return c.json(next);
});

// DELETE /admin/comments/:userId — explicit clear.
routes.delete('/admin/comments/:userId', async (c) => {
  const userId = c.req.param('userId');
  await deleteUserMeta(userId, PLUGIN_ID);
  return c.json({ ok: true });
});

export default {
  routes,
  async onActivate(ctx) {
    ctx.logger.info('activated');
  },
};
