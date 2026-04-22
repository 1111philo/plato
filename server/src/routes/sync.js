import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';

const sync = new Hono();

sync.use('/v1/sync', authenticate);
sync.use('/v1/sync/*', authenticate);

const VALID_DATA_KEYS = /^(profile|profileSummary|preferences|work|progress:.+|lessonKB:.+|lessonSession:.+|activities:.+|activityKBs:.+|drafts:.+|messages:.+|lessons:.+|onboardingComplete)$/;

// Keep user record name in sync with extension preferences
async function syncNameIfNeeded(userId, dataKey, data) {
  if (dataKey === 'preferences' && data?.name) {
    await db.updateUser(userId, { name: data.name });
  }
}

function validateDataKey(dataKey) {
  return VALID_DATA_KEYS.test(dataKey);
}

function lessonScopedId(dataKey) {
  if (dataKey.startsWith('lessonKB:')) return dataKey.slice('lessonKB:'.length);
  if (dataKey.startsWith('activities:')) return dataKey.slice('activities:'.length);
  if (dataKey.startsWith('activityKBs:')) return dataKey.slice('activityKBs:'.length);
  if (dataKey.startsWith('drafts:')) return dataKey.slice('drafts:'.length);
  if (dataKey.startsWith('messages:')) {
    const lessonId = dataKey.slice('messages:'.length);
    return lessonId.startsWith('create:') ? null : lessonId;
  }
  return null;
}

async function validateLessonSessionGuard(userId, dataKey, guard) {
  const lessonId = lessonScopedId(dataKey);
  if (!lessonId) return null;

  const lessonSessionItem = await db.getSyncData(userId, `lessonSession:${lessonId}`);
  const lessonSession = lessonSessionItem?.data || null;
  if (!guard?.lessonSessionId || !lessonSession || lessonSession.lessonSessionId !== guard.lessonSessionId) {
    return {
      error: 'Lesson session conflict',
      conflict: 'stale_session',
      serverVersion: lessonSessionItem?.version || 0,
      lessonSession,
    };
  }

  return null;
}

// GET /v1/sync — get all synced data
sync.get('/v1/sync', async (c) => {
  const userId = c.get('userId');
  const items = await db.getAllSyncData(userId);
  return c.json(items.map((item) => ({
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
    const lessonSessionConflict = await validateLessonSessionGuard(userId, item.dataKey, item.guard);
    if (lessonSessionConflict) {
      return { dataKey: item.dataKey, status: 'conflict', ...lessonSessionConflict };
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

  const { data, version, guard } = await c.req.json();
  if (data === undefined) {
    return c.json({ error: 'data is required' }, 400);
  }

  const lessonSessionConflict = await validateLessonSessionGuard(userId, dataKey, guard);
  if (lessonSessionConflict) {
    return c.json(lessonSessionConflict, 409);
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

// DELETE /v1/sync — delete all sync data for the authenticated user
sync.delete('/v1/sync', async (c) => {
  const userId = c.get('userId');
  const items = await db.getAllSyncData(userId);
  await Promise.all(items.map((item) => db.deleteSyncData(userId, item.dataKey)));
  return c.json({ ok: true, deleted: items.length });
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
