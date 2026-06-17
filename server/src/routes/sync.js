import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { isPublicLessonRecord } from '../lib/lesson-visibility.js';
import { emit as emitHook } from '../lib/plugins/hooks.js';
import { pluginRegistry } from '../lib/plugins/registry.js';

const sync = new Hono();

sync.use('/v1/sync', authenticate);
sync.use('/v1/sync/*', authenticate);

const VALID_DATA_KEYS = /^(profile|profileSummary|preferences|work|progress:.+|courseProgress:.+|lessonKB:.+|activities:.+|activityKBs:.+|drafts:.+|messages:.+|screenshot:.+|lessons:.+|onboardingComplete)$/;

// Keep user record name in sync with extension preferences
async function syncNameIfNeeded(userId, dataKey, data) {
  if (dataKey === 'preferences' && data?.name) {
    await db.updateUser(userId, { name: data.name });
  }
}

function validateDataKey(dataKey) {
  return VALID_DATA_KEYS.test(dataKey);
}

// Maintain denormalized activity counters on the user record (#136). Called
// after each successful sync write. `oldStatus` is the lessonKB status as
// it existed *before* the write (or null if no prior record / non-lessonKB);
// transitions only count on first flip to 'completed' so post-completion
// feedback turns don't double-count. Failures are swallowed — the primary
// write already succeeded and stat fields self-heal via lazy backfill in
// the admin endpoint. Note: lastActiveAt is NOT touched here — per the
// denormalization policy in CLAUDE.md, hot-path writes (every learner
// message) would cause user-table write amplification. It lives on the
// auth route instead, updated on login + refresh.
async function applyActivityEffects(userId, dataKey, oldStatus, data) {
  try {
    if (dataKey.startsWith('lessonKB:')) {
      if (oldStatus !== 'completed' && data?.status === 'completed') {
        // Only published (public) lessons count toward dashboard stats. Look
        // up the lesson's `_system` record; private/draft lessons and custom
        // lessons (which have no `_system:lesson:*` record) are excluded. The
        // admin stats endpoints recompute against the live public set, so a
        // missed/extra increment here self-heals — this just keeps the
        // denormalized counter close.
        const lessonId = dataKey.slice('lessonKB:'.length);
        const lesson = await db.getSyncData('_system', `lesson:${lessonId}`);
        if (lesson && isPublicLessonRecord(lesson.data)) {
          await db.incrementUserCounter(userId, 'lessonsCompleted', 1);
        }
      }
    }
  } catch { /* swallow — activity counters are best-effort */ }
}

// Pre-read the status of a lessonKB before writing it, so the post-write
// hook can detect a first-time transition to 'completed'. Skips the read
// for non-lessonKB keys to keep the hot path lean. **Errors must not
// propagate** — a failed pre-read just means we might miss one counter
// increment (lazy backfill heals it), but the learner's lesson write
// must never fail because of an ancillary read.
async function readOldLessonKBStatus(userId, dataKey) {
  if (!dataKey.startsWith('lessonKB:')) return null;
  try {
    const existing = await db.getSyncData(userId, dataKey);
    return existing?.data?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve which userId a request should read on behalf of.
 *
 * Admins can read another user's data by passing `?asUserId=<id>` (the
 * "View as User" feature — admin-only audit of a learner's classroom).
 * Non-admins passing `asUserId` get 403; anyone else falls back to their
 * own JWT-derived userId. Writes never honor `asUserId` — callers must
 * reject the request before reaching the DB.
 */
function resolveReadUserId(c) {
  const url = new URL(c.req.url);
  const asUserId = url.searchParams.get('asUserId');
  if (!asUserId) return { userId: c.get('userId'), impersonating: false };
  if (c.get('role') !== 'admin') {
    return { error: c.json({ error: 'Admin access required to read as another user' }, 403) };
  }
  return { userId: asUserId, impersonating: true };
}

function rejectWriteIfImpersonating(c) {
  const url = new URL(c.req.url);
  if (url.searchParams.get('asUserId')) {
    return c.json({ error: 'Writes are not allowed while viewing as another user' }, 403);
  }
  return null;
}

/**
 * Estimate the size of a sync-data item as it will be stored in DynamoDB.
 * DynamoDB caps items at 400 KB; screenshots can exceed this if the client-side
 * compression fails or is bypassed. Returns the approximate byte size.
 */
function estimateSyncDataSize(userId, dataKey, data) {
  const item = { userId, dataKey, data, updatedAt: new Date().toISOString(), version: 1 };
  return JSON.stringify(item).length;
}

const MAX_ITEM_SIZE = 380 * 1024; // 380 KB — slightly under DynamoDB's 400 KB limit for safety

// GET /v1/sync — get all synced data. Two record families are filtered out:
//   - `userMeta:<pluginId>` — plugin-owned, admin-only by default; the
//     plugin's own routes are responsible for any learner exposure.
//   - `screenshot:<key>` — pasted images, stored one-per-record and often
//     hundreds of KB each. Bundling them into this bulk payload (fetched on
//     every login *and* every tab refocus) would be wasteful; they're
//     fetched on demand by key via GET /v1/sync/:dataKey instead.
sync.get('/v1/sync', async (c) => {
  const resolved = resolveReadUserId(c);
  if (resolved.error) return resolved.error;
  const items = await db.getAllSyncData(resolved.userId);
  return c.json(items
    .filter((item) => !item.dataKey?.startsWith('userMeta:') && !item.dataKey?.startsWith('screenshot:'))
    .map((item) => ({
      dataKey: item.dataKey,
      data: item.data,
      version: item.version,
      updatedAt: item.updatedAt,
    })));
});

// GET /v1/sync/:dataKey — get specific item
sync.get('/v1/sync/:dataKey', async (c) => {
  const resolved = resolveReadUserId(c);
  if (resolved.error) return resolved.error;
  const dataKey = c.req.param('dataKey');

  if (!validateDataKey(dataKey)) {
    return c.json({ error: 'Invalid dataKey' }, 400);
  }

  const item = await db.getSyncData(resolved.userId, dataKey);
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
  const reject = rejectWriteIfImpersonating(c);
  if (reject) return reject;
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
    // Size guard for screenshots (same defense-in-depth as single PUT)
    if (item.dataKey.startsWith('screenshot:')) {
      const size = estimateSyncDataSize(userId, item.dataKey, item.data);
      if (size > MAX_ITEM_SIZE) {
        return {
          dataKey: item.dataKey,
          status: 'error',
          error: 'Screenshot too large',
          size,
          limit: MAX_ITEM_SIZE,
        };
      }
    }
    try {
      const oldStatus = await readOldLessonKBStatus(userId, item.dataKey);
      const result = await db.putSyncData(userId, item.dataKey, item.data, item.version || 0);
      await syncNameIfNeeded(userId, item.dataKey, item.data);
      await applyActivityEffects(userId, item.dataKey, oldStatus, item.data);
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
  const reject = rejectWriteIfImpersonating(c);
  if (reject) return reject;
  const userId = c.get('userId');
  const dataKey = c.req.param('dataKey');

  if (!validateDataKey(dataKey)) {
    return c.json({ error: 'Invalid dataKey' }, 400);
  }

  const { data, version } = await c.req.json();
  if (data === undefined) {
    return c.json({ error: 'data is required' }, 400);
  }

  // Defense-in-depth size check: reject items that will exceed DynamoDB's
  // 400 KB limit. Screenshots should be compressed client-side, but if
  // compression fails or is bypassed, reject here rather than letting the
  // write silently fail with an unhandled DynamoDB error.
  if (dataKey.startsWith('screenshot:')) {
    const size = estimateSyncDataSize(userId, dataKey, data);
    if (size > MAX_ITEM_SIZE) {
      return c.json({
        error: 'Screenshot is too large',
        details: 'Images must be compressed to under 380 KB. Please use a smaller image or reduce quality.',
        size,
        limit: MAX_ITEM_SIZE,
      }, 413);
    }
  }

  try {
    const oldStatus = await readOldLessonKBStatus(userId, dataKey);
    const result = await db.putSyncData(userId, dataKey, data, version || 0);
    await syncNameIfNeeded(userId, dataKey, data);
    await applyActivityEffects(userId, dataKey, oldStatus, data);
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
  const reject = rejectWriteIfImpersonating(c);
  if (reject) return reject;
  const userId = c.get('userId');
  const items = await db.getAllSyncData(userId);
  const deletable = items.filter((item) => !item.dataKey?.startsWith('userMeta:'));
  await Promise.all(deletable.map((item) => db.deleteSyncData(userId, item.dataKey)));
  return c.json({ ok: true, deleted: deletable.length });
});

// DELETE /v1/sync/:dataKey
sync.delete('/v1/sync/:dataKey', async (c) => {
  const reject = rejectWriteIfImpersonating(c);
  if (reject) return reject;
  const userId = c.get('userId');
  const dataKey = c.req.param('dataKey');

  if (!validateDataKey(dataKey)) {
    return c.json({ error: 'Invalid dataKey' }, 400);
  }

  await db.deleteSyncData(userId, dataKey);
  return c.json({ ok: true });
});

/**
 * POST /v1/sync/lesson-started — emit the lessonStarted hook and collect
 * enrichment responses from plugins. Called by the client when a learner
 * starts a lesson (after the lessonKB is initialized but before the coach
 * opens the conversation).
 *
 * Request body:
 *   - lessonId: string (required)
 *   - lesson: { name, markdown, exemplar, learningObjectives, coachDirective? } (required)
 *   - lessonKB: object (required)
 *
 * Response:
 *   - enrichments: array of enrichment objects from plugins
 *   - startupSteps: array of startup step definitions (future use)
 *
 * Enrichment object shape:
 *   - pluginId: string
 *   - label: string (display name)
 *   - context: string (reference material for coach)
 *   - reasoning: string (why this context matters)
 *   - sources: array of { url, title, excerpt }
 *
 * Plugins with hook.lessonStarted + lessonEnrichment capability can return
 * enrichment data. The host stores enrichments on lessonKB.enrichments,
 * injects them into the coach system context, and displays them in the
 * lesson overview "Additional Context" section.
 *
 * Fail-open: plugin errors are caught and logged; enrichment failures never
 * block lesson start.
 */
sync.post('/v1/sync/lesson-started', async (c) => {
  const reject = rejectWriteIfImpersonating(c);
  if (reject) return reject;
  const userId = c.get('userId');
  const { lessonId, lesson, lessonKB } = await c.req.json();

  if (!lessonId || !lesson || !lessonKB) {
    return c.json({ error: 'lessonId, lesson, and lessonKB are required' }, 400);
  }

  // Cap lesson.markdown size to prevent DoS (plugins inject it into AI prompts)
  if (lesson.markdown && lesson.markdown.length > 100_000) {
    return c.json({ error: 'lesson.markdown exceeds 100k character limit' }, 413);
  }

  // Collect startup steps from enabled plugins that declare lessonStartupSteps
  const startupSteps = [];
  for (const entry of pluginRegistry.list()) {
    if (entry.enabled && entry.manifest?.extensionPoints?.lessonStartupSteps) {
      const steps = entry.manifest.extensionPoints.lessonStartupSteps;
      for (const step of steps) {
        startupSteps.push({
          pluginId: entry.manifest.id,
          pluginLabel: entry.manifest.name,
          id: step.id,
          label: step.label,
          description: step.description,
          status: 'pending', // Plugins will report status via progress callback
        });
      }
    }
  }

  // Emit the hook. Plugins with hook.lessonStarted + lessonEnrichment capability
  // can return enrichment data: { context, sources, reasoning, pluginId, label }.
  // The emit function collects non-null return values from all handlers.

  // Debug: log what we're sending to plugins
  console.log('[lesson-started] Calling plugins for lesson:', {
    lessonId,
    name: lesson.name,
    hasCoachDirective: !!lesson.coachDirective,
    coachDirectiveLength: lesson.coachDirective?.length || 0,
    objectivesCount: lesson.learningObjectives?.length || 0,
  });

  const enrichments = await emitHook('lessonStarted', {
    userId,
    lessonId,
    lesson: {
      name: lesson.name,
      markdown: lesson.markdown,
      exemplar: lesson.exemplar,
      learningObjectives: lesson.learningObjectives,
      coachDirective: lesson.coachDirective,
    },
    lessonKB
  });

  console.log('[lesson-started] Enrichments returned:', enrichments.length);

  return c.json({
    enrichments: enrichments || [],
    startupSteps,
  });
});

export default sync;
