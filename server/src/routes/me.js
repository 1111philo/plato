import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { hashPassword } from '../lib/password.js';
import { validateUsername } from './auth.js';
import { pluginRegistry } from '../lib/plugins/registry.js';
import { listEvents, emit as emitHook } from '../lib/plugins/hooks.js';
import { STATIC_CAPABILITIES } from '../lib/plugins/capabilities.js';
import { PLUGIN_API_VERSION } from '../lib/plugins/version.js';

const me = new Hono();

me.use('/v1/me', authenticate);
me.use('/v1/me/*', authenticate);
me.use('/v1/plugins', authenticate);
me.use('/v1/plugins/extension-points', authenticate);

// GET /v1/me — get own profile
me.get('/v1/me', (c) => {
  const user = c.get('user');
  return c.json({
    userId: user.userId,
    email: user.email,
    username: user.username,
    name: user.name,
    userGroup: user.userGroup,
    role: user.role,
    createdAt: user.createdAt,
  });
});

// PATCH /v1/me — update profile fields
me.patch('/v1/me', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const allowed = ['name', 'email', 'username', 'group', 'password'];
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
      } else if (key === 'username') {
        const usernameErr = validateUsername(body.username);
        if (usernameErr) return c.json({ error: usernameErr }, 400);
        const existing = await db.getUserByUsername(body.username);
        if (existing && existing.userId !== userId) {
          return c.json({ error: 'Username already taken' }, 409);
        }
        updates.username = body.username.toLowerCase();
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
    username: updated.username,
    name: updated.name,
    userGroup: updated.userGroup,
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
      username: user.username,
      name: user.name,
      userGroup: user.userGroup,
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
    details: { name: user.name, userGroup: user.userGroup, role: user.role, selfDelete: true },
  });

  // Emit userDeleted BEFORE the cascade so plugins can read their per-user data
  // (userMeta:<id> records) while it still exists. Hook errors are caught by
  // emit(); they never block the deletion.
  await emitHook('userDeleted', { userId, email: user.email, role: user.role });

  // Delete all sync data (cascades plugin userMeta:* records too)
  const syncItems = await db.getAllSyncData(userId);
  for (const item of syncItems) {
    await db.deleteSyncData(userId, item.dataKey);
  }

  // Delete user record
  await db.deleteUser(userId);

  return c.json({ ok: true, message: 'Account and all associated data have been permanently deleted' });
});

// GET /v1/plugins — enabled plugins + sanitized settings (writeOnly fields
// stripped). Not admin-only; the client loader uses this to filter which slots
// render.
me.get('/v1/plugins', (c) => {
  const list = pluginRegistry.list().filter((e) => e.manifest && !e.loadError);
  return c.json(list.map((e) => ({
    ...pluginRegistry.publicView(e),
    settings: pluginRegistry.sanitizeSettings(e),
  })));
});

// GET /v1/plugins/extension-points — machine-readable inventory of slots, hooks,
// capabilities, and the host's API version. Used by AI agents (and tooling) to
// discover what's possible without grep-ing the codebase. See
// docs/plugins/AGENTS.md "Decision tree" for the expected agent workflow.
me.get('/v1/plugins/extension-points', (c) => {
  return c.json({
    apiVersion: PLUGIN_API_VERSION,
    slots: [
      { name: 'adminSettingsPanel', capability: 'ui.slot.adminSettingsPanel', context: 'admin', props: { pluginId: 'string', settings: 'object', onSave: '(next) => Promise<void>' }, location: 'client/src/pages/admin/AdminPlugins.jsx', phase: '1' },
      { name: 'adminUserRowAction', capability: 'ui.slot.adminUserRowAction', context: 'admin', props: { user: 'AdminUser' }, location: 'client/src/pages/admin/AdminUsers.jsx', phase: '1.1' },
      { name: 'adminProfileFields', capability: 'ui.slot.adminProfileFields', context: 'admin', props: { user: 'AdminUser' }, location: 'client/src/pages/admin/AdminUsers.jsx (Edit User card)', phase: '1.1' },
    ],
    hooks: {
      coreEmits: listEvents(),
      defined: [
        { name: 'userCreated', payload: '{ userId, email, role }', emitPoint: 'auth.js (signup, bootstrap-admin)', phase: '1.1' },
        { name: 'userDeleted', payload: '{ userId, email, role }', emitPoint: 'me.js DELETE /v1/me, admin.js DELETE /v1/admin/users/:id', phase: '1.1' },
        { name: 'userUpdated', payload: '{ userId, updates }', emitPoint: '(not yet wired)', phase: '2' },
        { name: 'profileUpdated', payload: '{ userId, key, data }', emitPoint: '(not yet wired)', phase: '2' },
        { name: 'lessonStarted', payload: '{ userId, lessonId, lessonKB }', emitPoint: '(not yet wired)', phase: '2' },
        { name: 'lessonCompleted', payload: '{ userId, lessonId, lessonKB }', emitPoint: '(not yet wired)', phase: '2' },
        { name: 'coachExchangeRecorded', payload: '{ userId, lessonId, messageCount }', emitPoint: '(not yet wired)', phase: '3' },
      ],
      note: 'Plugins MAY also emit/subscribe to arbitrary events using the convention <plugin-id>.<event>.',
    },
    capabilities: {
      static: STATIC_CAPABILITIES,
      patterns: ['ui.slot.<SlotName>', 'hook.<HookName>'],
    },
    docs: {
      authoring: 'docs/plugins/AUTHORING.md',
      agents: 'docs/plugins/AGENTS.md',
      reference: 'docs/plugins/EXTENSION_REFERENCE.md',
      schema: 'docs/plugins/plugin.schema.json',
    },
  });
});

export default me;
