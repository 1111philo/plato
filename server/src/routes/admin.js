import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { generateInviteToken } from '../lib/crypto.js';
import { sendInviteEmail } from '../lib/email.js';

const admin = new Hono();

admin.use('/v1/admin/*', authenticate, requireAdmin);

// GET /v1/admin/participants
admin.get('/v1/admin/participants', async (c) => {
  const users = await db.listAllUsers();
  return c.json(users.map((p) => ({
    userId: p.userId,
    email: p.email,
    name: p.name,
    affiliation: p.affiliation,
    role: p.role,
    createdAt: p.createdAt,
  })));
});

// GET /v1/admin/participants/:userId
admin.get('/v1/admin/participants/:userId', async (c) => {
  const user = await db.getUserById(c.req.param('userId'));
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  return c.json({
    userId: user.userId,
    email: user.email,
    name: user.name,
    affiliation: user.affiliation,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
});

// POST /v1/admin/invites — create invite and send email
admin.post('/v1/admin/invites', async (c) => {
  const { email } = await c.req.json();
  if (!email) {
    return c.json({ error: 'Email is required' }, 400);
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    return c.json({ error: 'User with this email already exists' }, 409);
  }

  const pendingInvite = await db.getInviteByEmail(email);
  if (pendingInvite) {
    return c.json({ error: 'A pending invite already exists for this email' }, 409);
  }

  const adminUser = c.get('user');
  const inviteToken = generateInviteToken();

  await db.createInvite({
    inviteToken,
    email,
    invitedBy: adminUser.userId,
  });

  const result = await sendInviteEmail(email, inviteToken, adminUser.name);

  return c.json({ inviteToken, email, ...result }, 201);
});

// POST /v1/admin/invites/bulk — invite multiple users from a list of emails
admin.post('/v1/admin/invites/bulk', async (c) => {
  const { emails } = await c.req.json();
  if (!Array.isArray(emails) || emails.length === 0) {
    return c.json({ error: 'emails array is required' }, 400);
  }
  if (emails.length > 200) {
    return c.json({ error: 'Maximum 200 invites per batch' }, 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const adminUser = c.get('user');
  const results = [];

  for (const email of emails) {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) continue;

    if (!emailRegex.test(trimmed)) {
      results.push({ email: trimmed, status: 'invalid', reason: 'Invalid email format' });
      continue;
    }

    const existing = await db.getUserByEmail(trimmed);
    if (existing) {
      results.push({ email: trimmed, status: 'skipped', reason: 'User already exists' });
      continue;
    }

    const pendingInvite = await db.getInviteByEmail(trimmed);
    if (pendingInvite) {
      results.push({ email: trimmed, status: 'skipped', reason: 'Pending invite already exists' });
      continue;
    }

    try {
      const inviteToken = generateInviteToken();
      await db.createInvite({
        inviteToken,
        email: trimmed,
        invitedBy: adminUser.userId,
      });
      const emailResult = await sendInviteEmail(trimmed, inviteToken, adminUser.name);
      results.push({ email: trimmed, status: 'sent', ...emailResult });
    } catch (err) {
      results.push({ email: trimmed, status: 'error', reason: err.message });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status !== 'sent').length;
  return c.json({ sent, skipped, total: results.length, results }, 201);
});

// GET /v1/admin/invites
admin.get('/v1/admin/invites', async (c) => {
  const invites = await db.listInvites();
  return c.json(invites.map((inv) => ({
    inviteToken: inv.inviteToken,
    email: inv.email,
    status: inv.status,
    createdAt: inv.createdAt,
  })));
});

// POST /v1/admin/invites/resend — resend invite to an email with a pending invite
admin.post('/v1/admin/invites/resend', async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: 'Email is required' }, 400);

  const pendingInvite = await db.getInviteByEmail(email.toLowerCase());
  if (!pendingInvite) {
    return c.json({ error: 'No pending invite found for this email' }, 404);
  }

  // Delete old invite and create a fresh one
  await db.deleteInvite(pendingInvite.inviteToken);
  const adminUser = c.get('user');
  const inviteToken = generateInviteToken();
  await db.createInvite({
    inviteToken,
    email: email.toLowerCase(),
    invitedBy: adminUser.userId,
  });

  const result = await sendInviteEmail(email.toLowerCase(), inviteToken, adminUser.name);
  return c.json({ inviteToken, email: email.toLowerCase(), ...result }, 201);
});

// DELETE /v1/admin/invites/:token
admin.delete('/v1/admin/invites/:token', async (c) => {
  const token = c.req.param('token');
  const invite = await db.getInvite(token);
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }
  await db.deleteInvite(token);
  return c.json({ ok: true });
});

// PATCH /v1/admin/participants/:userId — update participant fields
admin.patch('/v1/admin/participants/:userId', async (c) => {
  const userId = c.req.param('userId');
  const user = await db.getUserById(userId);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json();
  const updates = {};
  if (body.affiliation !== undefined) updates.affiliation = body.affiliation;
  if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields' }, 400);
  await db.updateUser(userId, updates);
  return c.json({ ok: true });
});

// PUT /v1/admin/participants/:userId/role
admin.put('/v1/admin/participants/:userId/role', async (c) => {
  const userId = c.req.param('userId');
  const adminUser = c.get('user');
  if (userId === adminUser.userId) {
    return c.json({ error: 'Cannot change your own role' }, 400);
  }
  const user = await db.getUserById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  const { role } = await c.req.json();
  if (role !== 'admin' && role !== 'participant') {
    return c.json({ error: 'Role must be admin or participant' }, 400);
  }
  await db.updateUser(userId, { role });
  return c.json({ ok: true, role });
});

// GET /v1/admin/settings
admin.get('/v1/admin/settings', async (c) => {
  const item = await db.getSyncData('_system', 'settings');
  return c.json(item?.data || {});
});

// PUT /v1/admin/settings
admin.put('/v1/admin/settings', async (c) => {
  const body = await c.req.json();
  const current = await db.getSyncData('_system', 'settings');
  const merged = { ...(current?.data || {}), ...body };
  await db.putSyncData('_system', 'settings', merged, current?.version || 0);
  return c.json(merged);
});

// PUT /v1/admin/affiliations — add or rename an affiliation
admin.put('/v1/admin/affiliations', async (c) => {
  const { name, oldName } = await c.req.json();
  if (!name || !name.trim()) {
    return c.json({ error: 'Affiliation name is required' }, 400);
  }
  const trimmed = name.trim();
  const current = await db.getSyncData('_system', 'settings');
  const settings = current?.data || {};
  const affiliations = settings.affiliations || [];

  if (oldName) {
    // Rename
    const idx = affiliations.indexOf(oldName);
    if (idx === -1) return c.json({ error: 'Affiliation not found' }, 404);
    affiliations[idx] = trimmed;
    // Update all users with the old affiliation
    const users = await db.listAllUsers();
    await Promise.all(
      users.filter((u) => u.affiliation === oldName)
        .map((u) => db.updateUser(u.userId, { affiliation: trimmed }))
    );
  } else {
    // Add
    if (affiliations.includes(trimmed)) {
      return c.json({ error: 'Affiliation already exists' }, 409);
    }
    affiliations.push(trimmed);
  }

  settings.affiliations = affiliations;
  await db.putSyncData('_system', 'settings', settings, current?.version || 0);
  return c.json({ affiliations });
});

// DELETE /v1/admin/affiliations/:name — remove an affiliation and clear from all users
admin.delete('/v1/admin/affiliations/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const current = await db.getSyncData('_system', 'settings');
  const settings = current?.data || {};
  const affiliations = settings.affiliations || [];
  const idx = affiliations.indexOf(name);
  if (idx === -1) return c.json({ error: 'Affiliation not found' }, 404);

  affiliations.splice(idx, 1);
  settings.affiliations = affiliations;
  await db.putSyncData('_system', 'settings', settings, current?.version || 0);

  // Clear affiliation from all users who had it
  const users = await db.listAllUsers();
  await Promise.all(
    users.filter((u) => u.affiliation === name)
      .map((u) => db.updateUser(u.userId, { affiliation: null }))
  );

  return c.json({ affiliations });
});

// DELETE /v1/admin/sync — reset sync data for all users
admin.delete('/v1/admin/sync', async (c) => {
  const adminUser = c.get('user');
  const users = await db.listAllUsers();
  const counts = await Promise.all(users.map(async (user) => {
    const items = await db.getAllSyncData(user.userId);
    await Promise.all(items.map((item) => db.deleteSyncData(user.userId, item.dataKey)));
    return items.length;
  }));
  const totalDeleted = counts.reduce((sum, n) => sum + n, 0);
  await db.createAuditLog({
    action: 'all_sync_data_reset',
    userId: adminUser.userId,
    email: adminUser.email,
    performedBy: adminUser.userId,
    details: { usersAffected: users.length, itemsDeleted: totalDeleted },
  });
  return c.json({ ok: true, usersAffected: users.length, itemsDeleted: totalDeleted });
});

// DELETE /v1/admin/participants/:userId
admin.delete('/v1/admin/participants/:userId', async (c) => {
  const userId = c.req.param('userId');
  const adminUser = c.get('user');
  if (userId === adminUser.userId) {
    return c.json({ error: 'Cannot delete yourself' }, 400);
  }
  const user = await db.getUserById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  // Log deletion before destroying data
  await db.createAuditLog({
    action: 'user_deleted',
    userId,
    email: user.email,
    performedBy: adminUser.userId,
    details: { name: user.name, affiliation: user.affiliation, role: user.role, selfDelete: false },
  });

  // Delete all sync data for this user
  const syncItems = await db.getAllSyncData(userId);
  await Promise.all(syncItems.map((item) => db.deleteSyncData(userId, item.dataKey)));
  await db.deleteUser(userId);
  return c.json({ ok: true });
});

// ── Content management (prompts, courses, knowledge base, theme) ──

// GET /v1/admin/prompts — list all prompts
admin.get('/v1/admin/prompts', async (c) => {
  const items = await db.getAllSyncData('_system');
  const prompts = items
    .filter(i => i.dataKey.startsWith('prompt:'))
    .map(i => ({
      name: i.dataKey.slice('prompt:'.length),
      updatedAt: i.updatedAt,
      updatedBy: i.data.updatedBy || null,
    }));
  return c.json(prompts);
});

// GET /v1/admin/prompts/:name
admin.get('/v1/admin/prompts/:name', async (c) => {
  const name = c.req.param('name');
  const item = await db.getSyncData('_system', `prompt:${name}`);
  if (!item) return c.json({ error: 'Prompt not found' }, 404);
  return c.json({ name, content: item.data.content, updatedAt: item.updatedAt });
});

// PUT /v1/admin/prompts/:name
admin.put('/v1/admin/prompts/:name', async (c) => {
  const name = c.req.param('name');
  const { content } = await c.req.json();
  if (content === undefined) return c.json({ error: 'content is required' }, 400);
  const adminUser = c.get('user');
  const current = await db.getSyncData('_system', `prompt:${name}`);
  await db.putSyncData('_system', `prompt:${name}`, {
    content,
    updatedBy: adminUser.userId,
  }, current?.version || 0);
  return c.json({ name, ok: true });
});

// GET /v1/admin/courses — list all courses
admin.get('/v1/admin/courses', async (c) => {
  const items = await db.getAllSyncData('_system');
  const courses = items
    .filter(i => i.dataKey.startsWith('course:'))
    .map(i => ({
      courseId: i.dataKey.slice('course:'.length),
      name: i.data.name || i.dataKey.slice('course:'.length),
      isBuiltIn: i.data.isBuiltIn || false,
      updatedAt: i.updatedAt,
    }));
  return c.json(courses);
});

// GET /v1/admin/courses/:courseId
admin.get('/v1/admin/courses/:courseId', async (c) => {
  const courseId = c.req.param('courseId');
  const item = await db.getSyncData('_system', `course:${courseId}`);
  if (!item) return c.json({ error: 'Course not found' }, 404);
  return c.json({ courseId, ...item.data, updatedAt: item.updatedAt });
});

// PUT /v1/admin/courses/:courseId
admin.put('/v1/admin/courses/:courseId', async (c) => {
  const courseId = c.req.param('courseId');
  const body = await c.req.json();
  if (!body.markdown) return c.json({ error: 'markdown is required' }, 400);
  const adminUser = c.get('user');
  const current = await db.getSyncData('_system', `course:${courseId}`);
  const data = {
    markdown: body.markdown,
    name: body.name || courseId,
    isBuiltIn: body.isBuiltIn || false,
    updatedBy: adminUser.userId,
    createdAt: current?.data?.createdAt || new Date().toISOString(),
  };
  await db.putSyncData('_system', `course:${courseId}`, data, current?.version || 0);
  return c.json({ courseId, ok: true });
});

// DELETE /v1/admin/courses/:courseId
admin.delete('/v1/admin/courses/:courseId', async (c) => {
  const courseId = c.req.param('courseId');
  const item = await db.getSyncData('_system', `course:${courseId}`);
  if (!item) return c.json({ error: 'Course not found' }, 404);
  await db.deleteSyncData('_system', `course:${courseId}`);
  return c.json({ ok: true });
});

// GET /v1/admin/knowledge-base
admin.get('/v1/admin/knowledge-base', async (c) => {
  const item = await db.getSyncData('_system', 'knowledgeBase');
  return c.json({ content: item?.data?.content || '' });
});

// PUT /v1/admin/knowledge-base
admin.put('/v1/admin/knowledge-base', async (c) => {
  const { content } = await c.req.json();
  if (content === undefined) return c.json({ error: 'content is required' }, 400);
  const current = await db.getSyncData('_system', 'knowledgeBase');
  const adminUser = c.get('user');
  await db.putSyncData('_system', 'knowledgeBase', {
    content,
    updatedBy: adminUser.userId,
  }, current?.version || 0);
  return c.json({ ok: true });
});

// GET /v1/admin/theme
admin.get('/v1/admin/theme', async (c) => {
  const item = await db.getSyncData('_system', 'settings');
  const settings = item?.data || {};
  return c.json({
    theme: settings.theme || {},
    logoBase64: settings.logoBase64 || null,
    logoAlt: settings.logoAlt || '1111 Learn',
  });
});

// PUT /v1/admin/theme
admin.put('/v1/admin/theme', async (c) => {
  const body = await c.req.json();
  const current = await db.getSyncData('_system', 'settings');
  const settings = { ...(current?.data || {}) };
  if (body.theme !== undefined) settings.theme = body.theme;
  if (body.logoBase64 !== undefined) settings.logoBase64 = body.logoBase64;
  if (body.logoAlt !== undefined) settings.logoAlt = body.logoAlt;
  await db.putSyncData('_system', 'settings', settings, current?.version || 0);
  return c.json({ ok: true });
});

export default admin;
