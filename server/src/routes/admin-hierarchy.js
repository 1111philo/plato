/**
 * Admin routes for the Course → Unit → Lesson hierarchy (#408). Registered
 * onto the admin app (`registerHierarchyRoutes(admin)` in admin.js), so they
 * sit behind `authenticate` + `authorize` and in the permission table.
 *
 * - Courses (UI) → `/v1/admin/programs*`, records `_system:program:<id>`
 * - Units (UI)   → `/v1/admin/units*`, records `_system:course:<id>`
 *   (`/v1/admin/courses*` stays as a deprecated alias for one release, so
 *   admin tabs open across the deploy keep working)
 *
 * See lib/hierarchy.js for the storage mapping and ordering rules.
 */
import db from '../lib/db.js';
import { buildHierarchy, isPermutation } from '../lib/hierarchy.js';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

function validateName(body, label) {
  if (!body || typeof body !== 'object') return 'Request body is required';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return `${label} name is required`;
  if (name.length > NAME_MAX) return `${label} name must be ${NAME_MAX} characters or fewer`;
  return null;
}

function nameTaken(items, prefix, selfId, name) {
  return items.some((i) => i.dataKey.startsWith(prefix) && i.dataKey.slice(prefix.length) !== selfId
    && (i.data?.name || '').trim().toLowerCase() === name.toLowerCase());
}

const actorName = (u) => u.username || u.email;

/**
 * Write with a version check; on a lost race, re-read and apply `change` once
 * more. If `change` returns the record unchanged (the same object), nothing
 * is written. Cascades rely on that to leave alone a record another admin
 * already moved.
 */
async function updateRecord(key, change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await db.getSyncData('_system', key);
    if (!cur) return false;
    const next = change(cur.data);
    if (next === cur.data) return false;
    try {
      await db.putSyncData('_system', key, next, cur.version);
      return true;
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException' || attempt === 1) throw err;
    }
  }
  return false;
}

export function registerHierarchyRoutes(admin) {
  // ── Units (stored as _system:course:<id>) ──────────────────────────────

  async function listUnits(c) {
    const items = await db.getAllSyncData('_system');
    const h = buildHierarchy(items);
    const meta = new Map(items.filter((i) => i.dataKey.startsWith('course:')).map((i) => [i.dataKey.slice(7), i]));
    const position = new Map();
    for (const p of h.programs) p.unitIds.forEach((id, idx) => position.set(id, idx));
    const units = [...h.units.values()].map((u) => ({
      unitId: u.id,
      courseId: u.id, // legacy field name (pre-#408 clients)
      name: u.name,
      programId: u.programId,
      position: position.has(u.id) ? position.get(u.id) : null,
      lessonIds: u.lessonIds,
      lessonCount: u.lessonIds.length,
      createdByName: meta.get(u.id)?.data?.createdByName || null,
      updatedByName: meta.get(u.id)?.data?.updatedByName || null,
      updatedAt: meta.get(u.id)?.updatedAt,
    }));
    units.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
    return c.json(units);
  }

  async function getUnit(c) {
    const id = c.req.param('unitId') || c.req.param('courseId');
    const item = await db.getSyncData('_system', `course:${id}`);
    if (!item) return c.json({ error: 'Unit not found' }, 404);
    return c.json({ unitId: id, courseId: id, ...item.data, updatedAt: item.updatedAt });
  }

  // Create or update. Preserves fields this request doesn't set (programId,
  // lessonIds). The pre-#408 handler rebuilt the record and would have
  // dropped them.
  async function putUnit(c) {
    const id = c.req.param('unitId') || c.req.param('courseId');
    const body = await c.req.json();
    const err = validateName(body, 'Unit');
    if (err) return c.json({ error: err }, 400);
    const name = body.name.trim();
    const items = await db.getAllSyncData('_system');
    if (nameTaken(items, 'course:', id, name)) return c.json({ error: 'A unit with that name already exists' }, 409);

    let programId;
    if (body.programId !== undefined) {
      programId = body.programId || null;
      if (programId && !items.some((i) => i.dataKey === `program:${programId}`)) {
        return c.json({ error: 'Course not found' }, 400);
      }
    }

    const user = c.get('user');
    const current = await db.getSyncData('_system', `course:${id}`);
    const now = new Date().toISOString();
    const prev = current?.data || {};
    const data = {
      ...prev,
      name,
      ...(programId !== undefined ? { programId } : {}),
      createdBy: prev.createdBy || user.userId,
      createdByName: prev.createdByName || actorName(user),
      createdAt: prev.createdAt || now,
      updatedBy: user.userId,
      updatedByName: actorName(user),
    };
    await db.putSyncData('_system', `course:${id}`, data, current?.version || 0);

    // Moving a unit between courses: put it at the end of the new course's
    // order and drop it from the old one. (Order arrays never decide
    // membership, but keeping them tidy keeps the next reorder exact.)
    if (programId !== undefined && programId !== (prev.programId || null)) {
      if (prev.programId) {
        await updateRecord(`program:${prev.programId}`, (d) => ({ ...d, unitIds: (d.unitIds || []).filter((u) => u !== id) }));
      }
      if (programId) {
        await updateRecord(`program:${programId}`, (d) => ({ ...d, unitIds: [...(d.unitIds || []).filter((u) => u !== id), id] }));
      }
    }
    return c.json({ unitId: id, courseId: id, ok: true });
  }

  // Delete, clear `course` on its lessons, and drop it from its course's order.
  async function deleteUnit(c) {
    const id = c.req.param('unitId') || c.req.param('courseId');
    const item = await db.getSyncData('_system', `course:${id}`);
    if (!item) return c.json({ error: 'Unit not found' }, 404);
    const items = await db.getAllSyncData('_system');
    const affected = items.filter((i) => i.dataKey.startsWith('lesson:') && i.data?.course === id).map((i) => i.dataKey);

    await db.deleteSyncData('_system', `course:${id}`);
    // Per-lesson re-read so a concurrent edit isn't clobbered, and skip any
    // lesson another admin already moved to a different unit.
    for (const key of affected) {
      await updateRecord(key, (d) => (d.course === id ? { ...d, course: null } : d));
    }
    if (item.data?.programId) {
      await updateRecord(`program:${item.data.programId}`, (d) => ({ ...d, unitIds: (d.unitIds || []).filter((u) => u !== id) }));
    }
    return c.json({ ok: true });
  }

  // PUT /v1/admin/units/:unitId/order: body { lessonIds }, exactly the unit's lessons, reordered.
  admin.put('/v1/admin/units/:unitId/order', async (c) => {
    const id = c.req.param('unitId');
    const { lessonIds } = await c.req.json();
    const h = buildHierarchy(await db.getAllSyncData('_system'));
    const unit = h.units.get(id);
    if (!unit) return c.json({ error: 'Unit not found' }, 404);
    if (!isPermutation(lessonIds, unit.lessonIds)) {
      return c.json({ error: "lessonIds must list each of the unit's lessons exactly once" }, 400);
    }
    await updateRecord(`course:${id}`, (d) => ({ ...d, lessonIds }));
    return c.json({ unitId: id, lessonIds });
  });

  admin.get('/v1/admin/units', listUnits);
  admin.get('/v1/admin/units/:unitId', getUnit);
  admin.put('/v1/admin/units/:unitId', putUnit);
  admin.delete('/v1/admin/units/:unitId', deleteUnit);
  // Deprecated aliases (pre-#408 clients), removable after the launch release.
  admin.get('/v1/admin/courses', listUnits);
  admin.get('/v1/admin/courses/:courseId', getUnit);
  admin.put('/v1/admin/courses/:courseId', putUnit);
  admin.delete('/v1/admin/courses/:courseId', deleteUnit);

  // ── Courses (stored as _system:program:<id>) ───────────────────────────

  admin.get('/v1/admin/programs', async (c) => {
    const items = await db.getAllSyncData('_system');
    const h = buildHierarchy(items);
    const meta = new Map(items.filter((i) => i.dataKey.startsWith('program:')).map((i) => [i.dataKey.slice(8), i]));
    return c.json({
      programs: h.programs.map((p) => ({
        programId: p.id,
        name: p.name,
        description: p.description,
        unitIds: p.unitIds,
        unitCount: p.unitIds.length,
        lessonCount: p.unitIds.reduce((n, u) => n + h.units.get(u).lessonIds.length, 0),
        updatedByName: meta.get(p.id)?.data?.updatedByName || null,
        updatedAt: meta.get(p.id)?.updatedAt,
      })),
      unassignedUnitIds: h.unassignedUnitIds,
    });
  });

  admin.get('/v1/admin/programs/:programId', async (c) => {
    const id = c.req.param('programId');
    const item = await db.getSyncData('_system', `program:${id}`);
    if (!item) return c.json({ error: 'Course not found' }, 404);
    return c.json({ programId: id, ...item.data, updatedAt: item.updatedAt });
  });

  admin.put('/v1/admin/programs/:programId', async (c) => {
    const id = c.req.param('programId');
    const body = await c.req.json();
    const err = validateName(body, 'Course');
    if (err) return c.json({ error: err }, 400);
    const name = body.name.trim();
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > DESCRIPTION_MAX)) {
      return c.json({ error: `Description must be text of ${DESCRIPTION_MAX} characters or fewer` }, 400);
    }
    const items = await db.getAllSyncData('_system');
    if (nameTaken(items, 'program:', id, name)) return c.json({ error: 'A course with that name already exists' }, 409);
    const user = c.get('user');
    const current = await db.getSyncData('_system', `program:${id}`);
    const now = new Date().toISOString();
    const prev = current?.data || {};
    const data = {
      ...prev,
      name,
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      unitIds: prev.unitIds || [],
      createdBy: prev.createdBy || user.userId,
      createdByName: prev.createdByName || actorName(user),
      createdAt: prev.createdAt || now,
      updatedBy: user.userId,
      updatedByName: actorName(user),
    };
    await db.putSyncData('_system', `program:${id}`, data, current?.version || 0);
    return c.json({ programId: id, ok: true });
  });

  // PUT /v1/admin/programs/:programId/order: body { unitIds }, exactly the course's units, reordered.
  admin.put('/v1/admin/programs/:programId/order', async (c) => {
    const id = c.req.param('programId');
    const { unitIds } = await c.req.json();
    const h = buildHierarchy(await db.getAllSyncData('_system'));
    const program = h.programs.find((p) => p.id === id);
    if (!program) return c.json({ error: 'Course not found' }, 404);
    if (!isPermutation(unitIds, program.unitIds)) {
      return c.json({ error: "unitIds must list each of the course's units exactly once" }, 400);
    }
    await updateRecord(`program:${id}`, (d) => ({ ...d, unitIds }));
    return c.json({ programId: id, unitIds });
  });

  // Delete a course; its units stay, just unassigned.
  admin.delete('/v1/admin/programs/:programId', async (c) => {
    const id = c.req.param('programId');
    const item = await db.getSyncData('_system', `program:${id}`);
    if (!item) return c.json({ error: 'Course not found' }, 404);
    const items = await db.getAllSyncData('_system');
    const units = items.filter((i) => i.dataKey.startsWith('course:') && i.data?.programId === id).map((i) => i.dataKey);
    await db.deleteSyncData('_system', `program:${id}`);
    for (const key of units) {
      await updateRecord(key, (d) => (d.programId === id ? { ...d, programId: null } : d));
    }
    return c.json({ ok: true });
  });
}
