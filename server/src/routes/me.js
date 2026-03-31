import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { hashPassword } from '../lib/password.js';

const me = new Hono();

me.use('/v1/me', authenticate);
me.use('/v1/me/*', authenticate);

// GET /v1/me — get own profile
me.get('/v1/me', (c) => {
  const user = c.get('user');
  return c.json({
    userId: user.userId,
    email: user.email,
    name: user.name,
    affiliation: user.affiliation,
    role: user.role,
    createdAt: user.createdAt,
  });
});

// PATCH /v1/me — update profile fields
me.patch('/v1/me', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const allowed = ['name', 'email', 'affiliation', 'password'];
  const updates = {};

  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'password') {
        if (body.password.length < 8) {
          return c.json({ error: 'Password must be at least 8 characters' }, 400);
        }
        updates.passwordHash = await hashPassword(body.password);
      } else if (key === 'email') {
        const existing = await db.getUserByEmail(body.email);
        if (existing && existing.userId !== userId) {
          return c.json({ error: 'Email already in use' }, 409);
        }
        updates.email = body.email.toLowerCase();
      } else {
        updates[key] = body[key];
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  await db.updateUser(userId, updates);
  const updated = await db.getUserById(userId);

  return c.json({
    userId: updated.userId,
    email: updated.email,
    name: updated.name,
    affiliation: updated.affiliation,
    role: updated.role,
  });
});

// GET /v1/me/export — download all user data as JSON
me.get('/v1/me/export', async (c) => {
  const user = c.get('user');
  const syncItems = await db.getAllSyncData(user.userId);
  const syncData = {};
  for (const item of syncItems) {
    syncData[item.dataKey] = { data: item.data, version: item.version, updatedAt: item.updatedAt };
  }
  const exported = {
    profile: {
      userId: user.userId,
      email: user.email,
      name: user.name,
      affiliation: user.affiliation,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    syncData,
    exportedAt: new Date().toISOString(),
  };
  return c.json(exported);
});

// DELETE /v1/me — self-delete account and all related data (irreversible)
me.delete('/v1/me', async (c) => {
  const body = await c.req.json();
  if (body.confirm !== 'DELETE') {
    return c.json({ error: 'Must send { "confirm": "DELETE" } to confirm irreversible account deletion' }, 400);
  }
  const user = c.get('user');
  const userId = user.userId;

  // Log deletion before destroying data
  await db.createAuditLog({
    action: 'user_deleted',
    userId,
    email: user.email,
    performedBy: userId,
    details: { name: user.name, affiliation: user.affiliation, role: user.role, selfDelete: true },
  });

  // Delete all sync data
  const syncItems = await db.getAllSyncData(userId);
  for (const item of syncItems) {
    await db.deleteSyncData(userId, item.dataKey);
  }

  // Delete user record
  await db.deleteUser(userId);

  return c.json({ ok: true, message: 'Account and all associated data have been permanently deleted' });
});

export default me;
