import { Hono } from 'hono';
import db from '../lib/db.js';
import { normalizeRole } from '../lib/permissions.js';
import { authenticate } from '../middleware/authenticate.js';
import { hashPassword } from '../lib/password.js';
import { validateUsername } from './auth.js';
import { nameFields, readNameInput } from '../lib/names.js';
import { readNotifyState, setOptOut } from '../lib/notifications.js';
import { messagesFor, markRead } from '../lib/messages.js';
import { pendingInviteFor, mergeProfile, acceptInvite, declineInvite } from '../lib/account-invites.js';
import { pluginRegistry } from '../lib/plugins/registry.js';
import { listEvents, emit as emitHook } from '../lib/plugins/hooks.js';
import { STATIC_CAPABILITIES } from '../lib/plugins/capabilities.js';
import { PLUGIN_API_VERSION } from '../lib/plugins/version.js';
import {
  getFieldDefinitions, mergeFieldValues, missingRequiredFields, visibleFieldValues,
} from '../lib/user-fields.js';

async function loadFieldDefinitions() {
  const settings = await db.getSyncData('_system', 'settings');
  return getFieldDefinitions(settings?.data);
}

const me = new Hono();

me.use('/v1/me', authenticate);
me.use('/v1/me/*', authenticate);
me.use('/v1/plugins', authenticate);
me.use('/v1/plugins/extension-points', authenticate);

// GET /v1/me — get own profile
me.get('/v1/me', async (c) => {
  const user = c.get('user');
  const defs = await loadFieldDefinitions();
  return c.json({
    userId: user.userId,
    email: user.email,
    username: user.username,
    ...nameFields(user),
    userGroup: user.userGroup,
    role: normalizeRole(user.role),
    customFields: visibleFieldValues(defs, user.customFields),
    createdAt: user.createdAt,
  });
});

// GET /v1/me/fields — admin-defined custom user fields (#364), the caller's
// values, and which required ones are still missing. Read fresh on every
// classroom load (the cached auth user can't know an admin just added a
// required field) — the client's ProfileCompletionGate blocks the classroom
// until `missing` is empty.
me.get('/v1/me/fields', async (c) => {
  const user = c.get('user');
  const defs = await loadFieldDefinitions();
  return c.json({
    userFields: defs,
    values: visibleFieldValues(defs, user.customFields),
    missing: missingRequiredFields(defs, user.customFields),
  });
});

// PATCH /v1/me — update profile fields
me.patch('/v1/me', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const allowed = ['email', 'username', 'group', 'password'];
  const updates = {};
  let defs = null;

  // firstName / lastName (#402); a lone `name` from an older client is split.
  const nameInput = readNameInput(body, { current: c.get('user') });
  if (nameInput.error) return c.json({ error: nameInput.error }, 400);
  if (nameInput.fields) Object.assign(updates, nameInput.fields);

  if (body.customFields !== undefined) {
    defs = await loadFieldDefinitions();
    const merged = mergeFieldValues(defs, c.get('user').customFields, body.customFields, { enforceRequired: true });
    if (merged.error) return c.json({ error: merged.error }, 400);
    updates.customFields = merged.values;
  }

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
  if (!defs) defs = await loadFieldDefinitions();

  return c.json({
    userId: updated.userId,
    email: updated.email,
    username: updated.username,
    ...nameFields(updated),
    userGroup: updated.userGroup,
    role: normalizeRole(updated.role),
    customFields: visibleFieldValues(defs, updated.customFields),
  });
});

// GET/PUT /v1/me/notifications — the learner's email opt-outs (#400):
// `{ optOut: { nudge?, digest?, messages? } }`, true meaning "don't email me".
// Stored in the server-only notify:state record.
me.get('/v1/me/notifications', async (c) => {
  const { optOut } = await readNotifyState(c.get('userId'));
  return c.json({ optOut });
});
me.put('/v1/me/notifications', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await setOptOut(c.get('userId'), body.optOut);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result);
});

// GET /v1/me/messages — announcements and messages for the bell (#389).
me.get('/v1/me/messages', async (c) => c.json({ messages: await messagesFor(c.get('user')) }));

// POST /v1/me/messages/read — body { ids }
me.post('/v1/me/messages/read', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await markRead(c.get('userId'), body.ids));
});

// GET /v1/me/invite — an invite to this account (#363: the person joined
// the wait list and an admin invited them), with what accepting would add.
me.get('/v1/me/invite', async (c) => {
  const user = c.get('user');
  const inv = await pendingInviteFor(user);
  if (!inv) return c.json({ invite: null });
  const settings = (await db.getSyncData('_system', 'settings'))?.data || {};
  const { userGroup, fields } = mergeProfile(user, inv.profile, settings);
  const labels = new Map(getFieldDefinitions(settings).map((d) => [d.id, d.label]));
  const inviter = inv.invitedBy ? await db.getUserById(inv.invitedBy).catch(() => null) : null;
  return c.json({
    invite: {
      inviteToken: inv.inviteToken,
      invitedByName: inviter ? nameFields(inviter).name || inviter.username || null : null,
      userGroup,
      fields: fields.map((id) => labels.get(id)),
      createdAt: inv.createdAt,
    },
  });
});

// POST /v1/me/invite/:token/accept — merge the invite's answers into the account
me.post('/v1/me/invite/:token/accept', async (c) => {
  const r = await acceptInvite(c.get('user'), c.req.param('token'));
  return r.error ? c.json({ error: r.error }, r.status) : c.json(r);
});

// POST /v1/me/invite/:token/decline — discard it; the account is untouched
me.post('/v1/me/invite/:token/decline', async (c) => {
  const r = await declineInvite(c.get('user'), c.req.param('token'));
  return r.error ? c.json({ error: r.error }, r.status) : c.json(r);
});

// GET /v1/me/export — download all user data as JSON.
// Plugin-owned `userMeta:*` records are admin-maintained (e.g. teacher
// comments) and explicitly NOT part of "the user's own data" — same
// isolation rule applied by GET/DELETE /v1/sync.
me.get('/v1/me/export', async (c) => {
  const user = c.get('user');
  const syncItems = (await db.getAllSyncData(user.userId))
    .filter((item) => !item.dataKey?.startsWith('userMeta:'));
  const defs = await loadFieldDefinitions();
  const syncData = {};
  for (const item of syncItems) {
    syncData[item.dataKey] = { data: item.data, version: item.version, updatedAt: item.updatedAt };
  }
  const exported = {
    profile: {
      userId: user.userId,
      email: user.email,
      username: user.username,
      ...nameFields(user),
      userGroup: user.userGroup,
      role: normalizeRole(user.role),
      // Exported with labels so the file is readable without the definitions.
      customFields: defs
        .filter((d) => typeof user.customFields?.[d.id] === 'string')
        .map((d) => ({ id: d.id, label: d.label, value: user.customFields[d.id] })),
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

  // The last admin can't delete themselves: nobody could run the classroom,
  // and /v1/auth/setup is closed once any user exists.
  if (normalizeRole(user.role) === 'admin') {
    const admins = (await db.listAllUsers()).filter((u) => normalizeRole(u.role) === 'admin').length;
    if (admins <= 1) return c.json({ error: 'You’re the only admin. Make someone else an admin before deleting your account.' }, 409);
  }

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
  await emitHook('userDeleted', { userId, email: user.email, role: normalizeRole(user.role) });

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
