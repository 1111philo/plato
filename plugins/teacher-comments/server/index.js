/**
 * Teacher Comments — server side.
 *
 * Stores admin notes about each learner. Mounted at /v1/plugins/teacher-comments/.
 *
 * Phase-1 storage workaround: comments live inside the plugin's own settings
 * record at `_system:plugins:activation.teacher-comments.settings.comments`,
 * keyed by userId. Phase 2's `userMeta:<pluginId>` namespace will be the
 * proper home — until then, every comment write rewrites the full settings
 * object. Acceptable for small classrooms (see GAPS.md).
 */

import {
  Hono,
  db,
  authenticate,
  requireAdmin,
} from '../../../server/src/lib/plugins/sdk.js';

const PLUGIN_ID = 'teacher-comments';
const ACTIVATION_KEY = 'plugins:activation';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

/**
 * Read comments + the activation record's version so callers can do an
 * optimistic-locked update. Returns `{ comments, version, record }`.
 */
async function readCommentsState() {
  const item = await db.getSyncData('_system', ACTIVATION_KEY);
  const record = (item?.data && typeof item.data === 'object') ? item.data : {};
  const settings = record[PLUGIN_ID]?.settings || {};
  const comments = (settings.comments && typeof settings.comments === 'object') ? settings.comments : {};
  return { comments, version: item?.version || 0, record };
}

/** Write back, preserving any other fields on the plugin's record. */
async function writeComments(comments, prev) {
  const next = { ...prev.record };
  const existing = next[PLUGIN_ID] || {};
  next[PLUGIN_ID] = {
    ...existing,
    enabled: existing.enabled ?? true,
    settings: { ...(existing.settings || {}), comments },
  };
  await db.putSyncData('_system', ACTIVATION_KEY, next, prev.version);
}

// GET /admin/comments — full map (for the settings panel).
routes.get('/admin/comments', async (c) => {
  const { comments } = await readCommentsState();
  return c.json(comments);
});

// GET /admin/comments/:userId — single comment (for the row-action popover).
routes.get('/admin/comments/:userId', async (c) => {
  const userId = c.req.param('userId');
  const { comments } = await readCommentsState();
  return c.json(comments[userId] || { text: '' });
});

// PUT /admin/comments/:userId — upsert. Body: { text: string }. Empty text deletes.
routes.put('/admin/comments/:userId', async (c) => {
  const userId = c.req.param('userId');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required' }, 400); }
  if (typeof body?.text !== 'string') return c.json({ error: 'text (string) required' }, 400);
  if (body.text.length > 4000) return c.json({ error: 'text must be ≤ 4000 chars' }, 400);

  const adminUser = c.get('user');
  const text = body.text.trim();

  // Retry once on optimistic-lock conflict (two admins editing different users
  // simultaneously rewrite the same activation record).
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await readCommentsState();
    const next = { ...state.comments };
    if (text === '') {
      delete next[userId];
    } else {
      next[userId] = { text, updatedAt: new Date().toISOString(), updatedBy: adminUser.userId };
    }
    try {
      await writeComments(next, state);
      return c.json(next[userId] || { text: '' });
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException' || attempt === 1) throw err;
    }
  }
});

// DELETE /admin/comments/:userId — clear.
routes.delete('/admin/comments/:userId', async (c) => {
  const userId = c.req.param('userId');
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await readCommentsState();
    const next = { ...state.comments };
    delete next[userId];
    try {
      await writeComments(next, state);
      return c.json({ ok: true });
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException' || attempt === 1) throw err;
    }
  }
});

export default {
  routes,
  async onActivate(ctx) {
    ctx.logger.info('activated');
  },
};
