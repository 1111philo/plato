import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';

const sync = new Hono();

sync.use('/v1/sync', authenticate);
sync.use('/v1/sync/*', authenticate);

const VALID_DATA_KEYS = /^(profile|profileSummary|preferences|work|progress:.+|lessonKB:.+|activities:.+|activityKBs:.+|drafts:.+|messages:.+|lessons:.+|onboardingComplete)$/;

// Keep user record name in sync with extension preferences
async function syncNameIfNeeded(userId, dataKey, data) {
  if (dataKey === 'preferences' && data?.name) {
    await db.updateUser(userId, { name: data.name });
  }
}

function validateDataKey(dataKey) {
  return VALID_DATA_KEYS.test(dataKey);
}

// GET /v1/sync — get all synced data. Plugin-owned per-user records
// (`userMeta:<pluginId>`) are filtered out — they're admin-only by default,
// and the plugin's own routes are responsible for any learner exposure.
sync.get('/v1/sync', async (c) => {
  const userId = c.get('userId');
  const items = await db.getAllSyncData(userId);
  return c.json(items
    .filter((item) => !item.dataKey?.startsWith('userMeta:'))
    .map((item) => ({
      dataKey: item.dataKey,
      data: item.data,
      version: item.version,
      updatedAt: item.updatedAt,
    })));
});

// GET /v1/sync/:dataKey — get specific item
sync.get('/v1/sync/:dataKey', async (c) => {
  const userId = c.get('userId');
  const dataKey = c.req.param('dataKey');

  if (!validateDataKey(dataKey)) {
    return c.json({ error: 'Invalid dataKey' }, 400);
  }

  const item = await db.getSyncData(userId, dataKey);
  if (!item) {
    return c.json({ dataKey, data: null, version: 0 });
  }
  return c.json({
    dataKey: item.dataKey,
    data: item.data,
    version: item.version,
    updatedAt: item.updatedAt,
  });
});

// PUT /v1/sync/batch — batch upsert (must be before :dataKey route)
sync.put('/v1/sync/batch', async (c) => {
  const userId = c.get('userId');
  const { items } = await c.req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'items array is required' }, 400);
  }

  if (items.length > 25) {
    return c.json({ error: 'Maximum 25 items per batch' }, 400);
  }

  const results = await Promise.all(items.map(async (item) => {
    if (!validateDataKey(item.dataKey) || item.data === undefined) {
      return { dataKey: item.dataKey, status: 'error', error: 'Invalid item' };
    }
    try {
      const result = await db.putSyncData(userId, item.dataKey, item.data, item.version || 0);
      await syncNameIfNeeded(userId, item.dataKey, item.data);
      return { dataKey: item.dataKey, status: 'ok', version: result.version };
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        const current = await db.getSyncData(userId, item.dataKey);
        return {
          dataKey: item.dataKey, status: 'conflict',
          serverVersion: current?.version || null,
        };
      }
      throw err;
    }
  }));

  return c.json({ results });
});

// PUT /v1/sync/:dataKey — upsert data with optimistic locking
sync.put('/v1/sync/:dataKey', async (c) => {
  const userId = c.get('userId');
  const dataKey = c.req.param('dataKey');

  if (!validateDataKey(dataKey)) {
    return c.json({ error: 'Invalid dataKey' }, 400);
  }

  const { data, version } = await c.req.json();
  if (data === undefined) {
    return c.json({ error: 'data is required' }, 400);
  }

  try {
    const result = await db.putSyncData(userId, dataKey, data, version || 0);
    await syncNameIfNeeded(userId, dataKey, data);
    return c.json({ dataKey, version: result.version, updatedAt: result.updatedAt });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      const current = await db.getSyncData(userId, dataKey);
      return c.json({
        error: 'Version conflict',
        serverVersion: current?.version || null,
      }, 409);
    }
    throw err;
  }
});

// DELETE /v1/sync — delete all sync data for the authenticated user.
// Plugin-owned `userMeta:*` records are admin-maintained (teacher comments,
// admin notes) and explicitly NOT the learner's to delete. Filter them out;
// they're cleaned up only via account deletion (DELETE /v1/me / admin-delete),
// which fires `userDeleted` first so plugins can react.
sync.delete('/v1/sync', async (c) => {
  const userId = c.get('userId');
  const items = await db.getAllSyncData(userId);
  const deletable = items.filter((item) => !item.dataKey?.startsWith('userMeta:'));
  await Promise.all(deletable.map((item) => db.deleteSyncData(userId, item.dataKey)));
  return c.json({ ok: true, deleted: deletable.length });
});

// DELETE /v1/sync/:dataKey
sync.delete('/v1/sync/:dataKey', async (c) => {
  const userId = c.get('userId');
  const dataKey = c.req.param('dataKey');

  if (!validateDataKey(dataKey)) {
    return c.json({ error: 'Invalid dataKey' }, 400);
  }

  await db.deleteSyncData(userId, dataKey);
  return c.json({ ok: true });
});

export default sync;
