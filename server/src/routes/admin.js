import { Hono } from 'hono';
import db from '../lib/db.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { generateInviteToken } from '../lib/crypto.js';
import { sendInviteEmail } from '../lib/email.js';
import { testSlackConnection, searchSlackUsers, listSlackChannels, listChannelMembers, sendSlackDM } from '../lib/slack.js';
import { APP_URL } from '../config.js';
import { validateUsername } from './auth.js';
import { MIN_OBJECTIVES, MAX_OBJECTIVES, MAX_EXCHANGES } from '../lib/lesson-limits.js';
import { logger } from '../lib/logger.js';
import { fetchCloudWatchLogs } from '../lib/cloudwatch-logs.js';

const admin = new Hono();

/** Validate lesson markdown for microlearning constraints. Returns error string or null. */
function validateLessonMarkdown(markdown) {
  const objSection = markdown.split(/^## Learning Objectives$/m)[1];
  if (!objSection) return 'Lesson must have a "## Learning Objectives" section.';
  const lines = objSection.split('\n');
  const objectives = [];
  for (const line of lines) {
    if (/^## /.test(line)) break;
    if (/^- Can .+/.test(line)) objectives.push(line);
  }
  if (objectives.length < MIN_OBJECTIVES) return `Too few objectives (${objectives.length}). Lessons need at least ${MIN_OBJECTIVES}.`;
  if (objectives.length > MAX_OBJECTIVES) return `Too many objectives (${objectives.length}). Microlearning lessons need ${MIN_OBJECTIVES}-${MAX_OBJECTIVES} objectives.`;
  return null;
}

/** Map legacy statuses to public/private. */
function normalizeStatus(status) {
  if (status === 'published' || status === 'public') return 'public';
  return 'private'; // draft, private, undefined → private
}

admin.use('/v1/admin/*', authenticate, requireAdmin);

// GET /v1/admin/users
admin.get('/v1/admin/users', async (c) => {
  const users = await db.listAllUsers();
  return c.json(users.map((p) => ({
    userId: p.userId,
    email: p.email,
    username: p.username,
    name: p.name,
    userGroup: p.userGroup,
    role: p.role,
    slackUserId: p.slackUserId || null,
    createdAt: p.createdAt,
  })));
});

// GET /v1/admin/users/:userId
admin.get('/v1/admin/users/:userId', async (c) => {
  const user = await db.getUserById(c.req.param('userId'));
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  return c.json({
    userId: user.userId,
    email: user.email,
    name: user.name,
    userGroup: user.userGroup,
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

// PATCH /v1/admin/users/:userId — update user fields
admin.patch('/v1/admin/users/:userId', async (c) => {
  const userId = c.req.param('userId');
  const user = await db.getUserById(userId);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const body = await c.req.json();
  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.email !== undefined) updates.email = body.email.toLowerCase();
  if (body.username !== undefined) {
    const usernameErr = validateUsername(body.username);
    if (usernameErr) return c.json({ error: usernameErr }, 400);
    const existing = await db.getUserByUsername(body.username);
    if (existing && existing.userId !== userId) {
      return c.json({ error: 'Username already taken' }, 409);
    }
    updates.username = body.username.toLowerCase();
  }
  if (body.userGroup !== undefined) updates.userGroup = body.userGroup;
  if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields' }, 400);
  await db.updateUser(userId, updates);
  return c.json({ ok: true });
});

// PUT /v1/admin/users/:userId/role
admin.put('/v1/admin/users/:userId/role', async (c) => {
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
  if (role !== 'admin' && role !== 'user') {
    return c.json({ error: 'Role must be admin or user' }, 400);
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

// PUT /v1/admin/groups — add or rename an group
admin.put('/v1/admin/groups', async (c) => {
  const { name, oldName } = await c.req.json();
  if (!name || !name.trim()) {
    return c.json({ error: 'Group name is required' }, 400);
  }
  const trimmed = name.trim();
  const current = await db.getSyncData('_system', 'settings');
  const settings = current?.data || {};
  const groups = settings.userGroups || [];

  if (oldName) {
    // Rename
    const idx = groups.indexOf(oldName);
    if (idx === -1) return c.json({ error: 'Group not found' }, 404);
    groups[idx] = trimmed;
    // Update all users with the old group
    const users = await db.listAllUsers();
    await Promise.all(
      users.filter((u) => u.userGroup === oldName)
        .map((u) => db.updateUser(u.userId, { userGroup: trimmed }))
    );
  } else {
    // Add
    if (groups.includes(trimmed)) {
      return c.json({ error: 'Group already exists' }, 409);
    }
    groups.push(trimmed);
  }

  settings.userGroups = groups;
  await db.putSyncData('_system', 'settings', settings, current?.version || 0);
  return c.json({ userGroups: groups });
});

// DELETE /v1/admin/groups/:name — remove an group and clear from all users
admin.delete('/v1/admin/groups/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const current = await db.getSyncData('_system', 'settings');
  const settings = current?.data || {};
  const groups = settings.userGroups || [];
  const idx = groups.indexOf(name);
  if (idx === -1) return c.json({ error: 'Group not found' }, 404);

  groups.splice(idx, 1);
  settings.userGroups = groups;
  await db.putSyncData('_system', 'settings', settings, current?.version || 0);

  // Clear group from all users who had it
  const users = await db.listAllUsers();
  await Promise.all(
    users.filter((u) => u.userGroup === name)
      .map((u) => db.updateUser(u.userId, { userGroup: null }))
  );

  return c.json({ userGroups: groups });
});

// DELETE /v1/admin/users/:userId
admin.delete('/v1/admin/users/:userId', async (c) => {
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
    details: { name: user.name, userGroup: user.userGroup, role: user.role, selfDelete: false },
  });

  // Delete all sync data for this user
  const syncItems = await db.getAllSyncData(userId);
  await Promise.all(syncItems.map((item) => db.deleteSyncData(userId, item.dataKey)));
  await db.deleteUser(userId);
  return c.json({ ok: true });
});

// ── Content management (prompts, lessons, knowledge base, theme) ──

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

// GET /v1/admin/lessons — list all lessons
admin.get('/v1/admin/lessons', async (c) => {
  const items = await db.getAllSyncData('_system');
  const lessons = items
    .filter(i => i.dataKey.startsWith('lesson:'))
    .map(i => ({
      lessonId: i.dataKey.slice('lesson:'.length),
      name: i.data.name || i.dataKey.slice('lesson:'.length),
      isBuiltIn: i.data.isBuiltIn || false,
      status: normalizeStatus(i.data.status),
      sharedWith: i.data.sharedWith || [],
      createdByName: i.data.createdByName || null,
      updatedAt: i.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return c.json(lessons);
});

// GET /v1/admin/lessons/:lessonId
admin.get('/v1/admin/lessons/:lessonId', async (c) => {
  const lessonId = c.req.param('lessonId');
  const item = await db.getSyncData('_system', `lesson:${lessonId}`);
  if (!item) return c.json({ error: 'Lesson not found' }, 404);
  return c.json({ lessonId, ...item.data, updatedAt: item.updatedAt });
});

// PUT /v1/admin/lessons/:lessonId
admin.put('/v1/admin/lessons/:lessonId', async (c) => {
  const lessonId = c.req.param('lessonId');
  const body = await c.req.json();
  const adminUser = c.get('user');
  const current = await db.getSyncData('_system', `lesson:${lessonId}`);
  // Validate markdown when it's new/changed, or when making public
  const hasMarkdown = body.markdown || current?.data?.markdown;
  if (!hasMarkdown) return c.json({ error: 'markdown is required' }, 400);
  const markdownToValidate = body.markdown || current?.data?.markdown;
  const newStatus = normalizeStatus(body.status || current?.data?.status);
  const currentStatus = normalizeStatus(current?.data?.status);
  const isGoingPublic = newStatus === 'public' && currentStatus !== 'public';
  const markdownChanged = body.markdown && body.markdown !== current?.data?.markdown;
  if (markdownChanged || isGoingPublic) {
    const mdError = validateLessonMarkdown(markdownToValidate);
    if (mdError) return c.json({ error: mdError }, 400);
  }
  // sharedWith is independent of status — validate format if provided
  const sharedWith = body.sharedWith !== undefined ? body.sharedWith : (current?.data?.sharedWith || []);
  if (sharedWith.length > 0 && (!Array.isArray(sharedWith) || !sharedWith.every(id => typeof id === 'string'))) {
    return c.json({ error: 'sharedWith must be an array of user ID strings' }, 400);
  }
  const data = {
    markdown: body.markdown || current?.data?.markdown,
    name: body.name || current?.data?.name || lessonId,
    isBuiltIn: body.isBuiltIn || false,
    status: newStatus,
    sharedWith,
    conversation: body.conversation !== undefined ? body.conversation : (current?.data?.conversation || null),
    readiness: body.readiness !== undefined ? body.readiness : (current?.data?.readiness ?? null),
    updatedBy: adminUser.userId,
    createdBy: current?.data?.createdBy || adminUser.userId,
    createdByName: current?.data?.createdByName || adminUser.username || adminUser.email,
    createdAt: current?.data?.createdAt || new Date().toISOString(),
  };
  await db.putSyncData('_system', `lesson:${lessonId}`, data, current?.version || 0);
  return c.json({ lessonId, ok: true });
});

// PUT /v1/admin/lessons/:lessonId/conversation — auto-save conversation without requiring markdown
admin.put('/v1/admin/lessons/:lessonId/conversation', async (c) => {
  const lessonId = c.req.param('lessonId');
  const body = await c.req.json();
  const current = await db.getSyncData('_system', `lesson:${lessonId}`);
  if (!current) return c.json({ error: 'Lesson not found' }, 404);
  const data = { ...current.data };
  data.conversation = body.conversation || null;
  if (body.readiness !== undefined) data.readiness = body.readiness;
  await db.putSyncData('_system', `lesson:${lessonId}`, data, current.version);
  return c.json({ ok: true });
});

// PUT /v1/admin/draft-conversation — auto-save new lesson conversation (before lesson exists)
admin.put('/v1/admin/draft-conversation', async (c) => {
  const body = await c.req.json();
  const current = await db.getSyncData('_system', 'draft:lesson-conversation');
  await db.putSyncData('_system', 'draft:lesson-conversation', {
    conversation: body.conversation || null,
    readiness: body.readiness ?? 0,
  }, current?.version || 0);
  return c.json({ ok: true });
});

// GET /v1/admin/draft-conversation — resume new lesson conversation
admin.get('/v1/admin/draft-conversation', async (c) => {
  const item = await db.getSyncData('_system', 'draft:lesson-conversation');
  if (!item?.data?.conversation?.length) return c.json({ conversation: null, readiness: 0 });
  return c.json({ conversation: item.data.conversation, readiness: item.data.readiness ?? 0 });
});

// DELETE /v1/admin/draft-conversation — clear draft after lesson is created
admin.delete('/v1/admin/draft-conversation', async (c) => {
  await db.deleteSyncData('_system', 'draft:lesson-conversation');
  return c.json({ ok: true });
});

// DELETE /v1/admin/lessons/:lessonId
admin.delete('/v1/admin/lessons/:lessonId', async (c) => {
  const lessonId = c.req.param('lessonId');
  const item = await db.getSyncData('_system', `lesson:${lessonId}`);
  if (!item) return c.json({ error: 'Lesson not found' }, 404);
  await db.deleteSyncData('_system', `lesson:${lessonId}`);
  return c.json({ ok: true });
});

// GET /v1/admin/knowledge-base
admin.get('/v1/admin/knowledge-base', async (c) => {
  const item = await db.getSyncData('_system', 'knowledgeBase');
  const data = item?.data || {};
  let updatedByName = null;
  if (data.updatedBy && data.updatedBy !== 'setup') {
    const user = await db.getUserById(data.updatedBy);
    updatedByName = user?.name || user?.username || user?.email || null;
  }
  return c.json({
    content: data.content || '',
    conversation: data.conversation || null,
    readiness: data.readiness ?? null,
    updatedAt: item?.updatedAt || null,
    updatedByName,
  });
});

// PUT /v1/admin/knowledge-base
admin.put('/v1/admin/knowledge-base', async (c) => {
  const body = await c.req.json();
  if (body.content === undefined) return c.json({ error: 'content is required' }, 400);
  const current = await db.getSyncData('_system', 'knowledgeBase');
  const adminUser = c.get('user');
  await db.putSyncData('_system', 'knowledgeBase', {
    content: body.content,
    conversation: body.conversation !== undefined ? body.conversation : (current?.data?.conversation || null),
    readiness: body.readiness !== undefined ? body.readiness : (current?.data?.readiness ?? null),
    updatedBy: adminUser.userId,
  }, current?.version || 0);
  return c.json({ ok: true });
});

// PUT /v1/admin/knowledge-base/conversation — auto-save KB editor conversation
admin.put('/v1/admin/knowledge-base/conversation', async (c) => {
  const body = await c.req.json();
  const current = await db.getSyncData('_system', 'knowledgeBase');
  const adminUser = c.get('user');
  await db.putSyncData('_system', 'knowledgeBase', {
    content: current?.data?.content || '',
    conversation: body.conversation || null,
    readiness: body.readiness !== undefined ? body.readiness : (current?.data?.readiness ?? null),
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
    classroomName: settings.classroomName || settings.logoAlt || '',
  });
});

// PUT /v1/admin/theme
admin.put('/v1/admin/theme', async (c) => {
  const body = await c.req.json();
  const current = await db.getSyncData('_system', 'settings');
  const settings = { ...(current?.data || {}) };
  if (body.theme !== undefined) settings.theme = body.theme;
  if (body.logoBase64 !== undefined) settings.logoBase64 = body.logoBase64;
  if (body.classroomName !== undefined) {
    settings.classroomName = body.classroomName;
    settings.logoAlt = body.classroomName; // backward compat
  }
  await db.putSyncData('_system', 'settings', settings, current?.version || 0);
  return c.json({ ok: true });
});


// ── Slack integration ──

// Helper: get Slack bot token from settings
async function getSlackToken() {
  const item = await db.getSyncData('_system', 'settings');
  return item?.data?.slack?.botToken || null;
}

// POST /v1/admin/slack/test — validate a bot token
admin.post('/v1/admin/slack/test', async (c) => {
  const { botToken } = await c.req.json();
  if (!botToken) return c.json({ error: 'botToken is required' }, 400);
  try {
    const result = await testSlackConnection(botToken);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'Invalid token or Slack API error', detail: e.message }, 400);
  }
});

// GET /v1/admin/slack/users?q= — search workspace users
admin.get('/v1/admin/slack/users', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);
  try {
    const q = c.req.query('q') || '';
    const users = await searchSlackUsers(token, q);
    return c.json(users);
  } catch (e) {
    return c.json({ error: 'Slack API error', detail: e.message }, 500);
  }
});

// GET /v1/admin/slack/channels — list public channels
admin.get('/v1/admin/slack/channels', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);
  try {
    const channels = await listSlackChannels(token);
    return c.json(channels);
  } catch (e) {
    return c.json({ error: 'Slack API error', detail: e.message }, 500);
  }
});

// GET /v1/admin/slack/channels/:id/members — list channel members
admin.get('/v1/admin/slack/channels/:id/members', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);
  try {
    const members = await listChannelMembers(token, c.req.param('id'));
    return c.json(members);
  } catch (e) {
    return c.json({ error: 'Slack API error', detail: e.message }, 500);
  }
});

// POST /v1/admin/slack/invites — invite users via Slack DM
admin.post('/v1/admin/slack/invites', async (c) => {
  const token = await getSlackToken();
  if (!token) return c.json({ error: 'Slack integration not configured' }, 400);

  const { users } = await c.req.json();
  if (!Array.isArray(users) || users.length === 0) {
    return c.json({ error: 'users array is required' }, 400);
  }
  if (users.length > 200) {
    return c.json({ error: 'Maximum 200 invites per batch' }, 400);
  }

  const adminUser = c.get('user');
  const classroom = await (async () => {
    const item = await db.getSyncData('_system', 'settings');
    const s = item?.data || {};
    return s.logoAlt || 'plato';
  })();

  const results = [];
  for (const u of users) {
    const email = (u.email || '').trim().toLowerCase();
    if (!email) {
      results.push({ slackUserId: u.slackUserId, status: 'skipped', reason: 'No email on Slack profile' });
      continue;
    }

    const existing = await db.getUserByEmail(email);
    if (existing) {
      results.push({ email, slackUserId: u.slackUserId, status: 'skipped', reason: 'User already exists' });
      continue;
    }

    const pendingInvite = await db.getInviteByEmail(email);
    if (pendingInvite) {
      results.push({ email, slackUserId: u.slackUserId, status: 'skipped', reason: 'Pending invite already exists' });
      continue;
    }

    try {
      const inviteToken = generateInviteToken();
      await db.createInvite({
        inviteToken,
        email,
        invitedBy: adminUser.userId,
        slackUserId: u.slackUserId,
      });

      const signupUrl = `${APP_URL}/signup?token=${inviteToken}`;
      const message = `${adminUser.name ? `${adminUser.name} has` : "You've been"} invited you to join *${classroom}*.\n\n<${signupUrl}|Create your account>\n\nThis invite expires in 7 days.`;

      await sendSlackDM(token, u.slackUserId, message);
      results.push({ email, slackUserId: u.slackUserId, status: 'sent' });
    } catch (err) {
      results.push({ email, slackUserId: u.slackUserId, status: 'error', reason: err.message });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status !== 'sent').length;
  return c.json({ sent, skipped, total: results.length, results }, 201);
});

// GET /v1/admin/stats/lessons — lesson pacing KPIs
// MAX_EXCHANGES is not a hard cutoff — it's the target for good lesson pacing.
// Lessons always run until the exemplar is achieved (progress >= 10).
admin.get('/v1/admin/stats/lessons', async (c) => {
  // MAX_EXCHANGES imported at top from lesson-limits.js
  const hardLimit = MAX_EXCHANGES * 2;
  const users = await db.listAllUsers();
  let withinTarget = 0;
  let overTarget = 0;
  let hitHardLimit = 0;
  let totalExchangesWithin = 0;
  let totalExchangesOver = 0;
  let activeLessons = 0;
  const durations = []; // in minutes

  for (const user of users) {
    const syncItems = await db.getAllSyncData(user.userId);
    for (const item of syncItems) {
      if (!item.dataKey?.startsWith('lessonKB:')) continue;
      const kb = item.data;
      if (!kb) continue;
      if (kb.status === 'completed') {
        const exchanges = kb.activitiesCompleted || 0;
        if (exchanges >= hardLimit && kb.progress < 10) {
          hitHardLimit++;
          totalExchangesOver += exchanges;
        } else if (exchanges <= MAX_EXCHANGES) {
          withinTarget++;
          totalExchangesWithin += exchanges;
        } else {
          overTarget++;
          totalExchangesOver += exchanges;
        }
        // Compute duration if timestamps are available
        if (kb.startedAt && kb.completedAt) {
          durations.push((kb.completedAt - kb.startedAt) / 60000);
        } else {
          // Fallback: try to get duration from message timestamps
          const lessonId = item.dataKey.replace('lessonKB:', '');
          const msgItem = syncItems.find(s => s.dataKey === `messages:${lessonId}`);
          const msgs = msgItem?.data;
          if (Array.isArray(msgs) && msgs.length >= 2) {
            const first = msgs[0]?.timestamp;
            const last = msgs[msgs.length - 1]?.timestamp;
            if (first && last) durations.push((last - first) / 60000);
          }
        }
      } else {
        activeLessons++;
      }
    }
  }

  const totalCompletions = withinTarget + overTarget + hitHardLimit;
  const avgDurationMinutes = durations.length
    ? +(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)
    : null;
  return c.json({
    totalCompletions,
    withinTarget,
    overTarget,
    hitHardLimit,
    exchangeTarget: MAX_EXCHANGES,
    hardLimit,
    avgExchangesPerCompletion: totalCompletions ? +((totalExchangesWithin + totalExchangesOver) / totalCompletions).toFixed(1) : null,
    avgExchangesWithinTarget: withinTarget ? +(totalExchangesWithin / withinTarget).toFixed(1) : null,
    avgExchangesOverTarget: (overTarget + hitHardLimit) ? +(totalExchangesOver / (overTarget + hitHardLimit)).toFixed(1) : null,
    avgDurationMinutes,
    activeLessons,
  });
});

// GET /v1/admin/logs — recent server errors/warnings for the pilot agent.
// Merges in-process ring buffer with CloudWatch (default on). Failures from
// CloudWatch populate `cloudwatch.error` rather than silently returning empty.
admin.get('/v1/admin/logs', async (c) => {
  const url = new URL(c.req.url);
  const rawSince = url.searchParams.get('since');
  const levelParam = url.searchParams.get('level');
  const limitParam = parseInt(url.searchParams.get('limit') || '200', 10);
  const cloudwatchParam = url.searchParams.get('cloudwatch');
  const view = url.searchParams.get('view') || 'both';

  const level = levelParam === 'error' || levelParam === 'warn' ? levelParam : undefined;
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 200, 1), 1000);
  const includeCloudWatch = cloudwatchParam !== '0';

  let since;
  if (rawSince) {
    const t = new Date(rawSince).getTime();
    if (!Number.isFinite(t)) return c.json({ error: 'Invalid since parameter' }, 400);
    since = new Date(t).toISOString();
  } else {
    since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }

  const bufferEntries = logger.recent({ since, level, limit: logger._bufferSize() }).map((e) => ({ ...e, source: 'buffer' }));

  let cloudwatch = { logGroups: [], error: null };
  let cwEntries = [];
  if (includeCloudWatch) {
    const cw = await fetchCloudWatchLogs({ since });
    cloudwatch = { logGroups: cw.logGroups, error: cw.error };
    cwEntries = (cw.entries || []).filter((e) => !level || e.level === level);
  }

  // Merge, dedupe by logId, sort newest-first.
  const merged = new Map();
  for (const e of [...bufferEntries, ...cwEntries]) merged.set(e.logId, e);
  const entries = [...merged.values()].sort((a, b) => b.ts.localeCompare(a.ts));

  // Build groups across both sources.
  const groups = new Map();
  for (const e of entries) {
    const g = groups.get(e.code);
    if (!g) {
      groups.set(e.code, {
        code: e.code,
        level: e.level,
        count: 1,
        firstSeen: e.ts,
        lastSeen: e.ts,
        sources: [e.source],
        sample: e,
      });
    } else {
      g.count++;
      if (e.ts < g.firstSeen) g.firstSeen = e.ts;
      if (e.ts > g.lastSeen) { g.lastSeen = e.ts; g.sample = e; }
      if (!g.sources.includes(e.source)) g.sources.push(e.source);
    }
  }
  const groupsList = [...groups.values()].sort((a, b) => b.count - a.count);

  const counts = { error: 0, warn: 0 };
  for (const e of entries) {
    if (e.level === 'error' || e.level === 'warn') counts[e.level]++;
  }

  const windowMs = Date.now() - new Date(since).getTime();
  const response = {
    windowHours: +(windowMs / 3600000).toFixed(2),
    since,
    counts,
    buffer: { size: logger._bufferSize(), used: bufferEntries.length },
    cloudwatch,
  };
  if (view !== 'entries') response.groups = groupsList;
  if (view !== 'groups') response.entries = entries.slice(0, limit);

  return c.json(response);
});

export default admin;
