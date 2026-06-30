import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import db from '../lib/db.js';
import { generateUserId, generateRefreshToken, generateResetToken, hashToken } from '../lib/crypto.js';
import { hashPassword, comparePassword } from '../lib/password.js';
import { signAccessToken } from '../lib/jwt.js';
import { sendResetEmail } from '../lib/email.js';
import { seedDefaultContent } from '../lib/seed.js';
import { emit as emitHook } from '../lib/plugins/hooks.js';

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,28}[a-zA-Z0-9]$/;

function validateUsername(username) {
  if (!username || typeof username !== 'string') return 'Username is required';
  if (username.length < 3 || username.length > 30) return 'Username must be 3-30 characters';
  if (!USERNAME_RE.test(username)) return 'Username must be alphanumeric with hyphens or underscores, and cannot start/end with them';
  if (username.includes('@')) return 'Username cannot contain @';
  return null;
}

function generateUsername() {
  return 'user-' + randomBytes(3).toString('hex');
}

const auth = new Hono();

// GET /v1/auth/setup-status — check if initial setup is needed
auth.get('/v1/auth/setup-status', async (c) => {
  const count = await db.countUsers();
  return c.json({ needsSetup: count === 0 });
});

// POST /v1/auth/setup — create the first admin account (only works when no users exist)
auth.post('/v1/auth/setup', async (c) => {
  const count = await db.countUsers();
  if (count > 0) {
    return c.json({ error: 'Setup already completed' }, 400);
  }

  const { email, name, password, username: rawUsername, classroomName } = await c.req.json();
  if (!email || !name || !password) {
    return c.json({ error: 'email, name, and password are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const username = rawUsername ? rawUsername.toLowerCase() : generateUsername();
  if (rawUsername) {
    const usernameErr = validateUsername(rawUsername);
    if (usernameErr) return c.json({ error: usernameErr }, 400);
    const existingUsername = await db.getUserByUsername(rawUsername);
    if (existingUsername) return c.json({ error: 'Username already taken' }, 409);
  }

  const userId = generateUserId();
  const passwordHash = await hashPassword(password);

  await db.createUser({
    userId,
    email: email.toLowerCase(),
    username,
    passwordHash,
    name,
    role: 'admin',
  });

  // Emit userCreated so plugins can react. Errors in handlers are caught and
  // logged inside emit() — never bubble up to the user-facing request.
  await emitHook('userCreated', { userId, email: email.toLowerCase(), role: 'admin' });

  // Seed default prompts and lessons
  try { await seedDefaultContent(); } catch (e) {
    console.error('Content seed failed (non-fatal):', e.message);
  }

  // Save classroom name if provided
  if (classroomName?.trim()) {
    try {
      const current = await db.getSyncData('_system', 'settings');
      const settings = { ...(current?.data || {}), classroomName: classroomName.trim(), logoAlt: classroomName.trim() };
      if (!settings.theme) settings.theme = { primary: '#8b1a1a', accent: '#dc2626' };
      await db.putSyncData('_system', 'settings', settings, current?.version || 0);
    } catch (e) {
      console.error('Classroom name save failed (non-fatal):', e.message);
    }
  }

  const accessToken = await signAccessToken(userId, 'admin');
  const refreshToken = generateRefreshToken();
  await db.storeRefreshToken(hashToken(refreshToken), userId);

  return c.json({
    accessToken,
    refreshToken,
    user: { userId, email: email.toLowerCase(), username, name, role: 'admin' },
  }, 201);
});

// POST /v1/auth/signup — sign up with invite token
auth.post('/v1/auth/signup', async (c) => {
  const { inviteToken, name, password, username: rawUsername, userGroup, email: providedEmail } = await c.req.json();

  if (!inviteToken || !name || !password) {
    return c.json({ error: 'inviteToken, name, and password are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const invite = await db.getInvite(inviteToken);
  if (!invite || invite.status !== 'pending') {
    return c.json({ error: 'Invalid or expired invite' }, 400);
  }

  // Check TTL hasn't passed (DynamoDB TTL deletion is async)
  if (invite.ttl && invite.ttl < Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'Invalid or expired invite' }, 400);
  }

  // Determine the email based on invite type
  let userEmail;
  if (invite.email) {
    // Email-specific invite: email must match if provided (for backwards compat, providedEmail is optional)
    if (providedEmail && providedEmail.toLowerCase() !== invite.email.toLowerCase()) {
      return c.json({ error: 'This invite is for a different email address' }, 400);
    }
    userEmail = invite.email;
  } else if (invite.isLink) {
    // Link invite: any email allowed, but email is required
    if (!providedEmail) {
      return c.json({ error: 'Email is required' }, 400);
    }
    userEmail = providedEmail.toLowerCase();
    // NOTE: Usage limit check is done atomically in incrementLinkUsage() to prevent race conditions.
    // The check-then-increment here would allow concurrent signups to exceed the limit.
  } else {
    return c.json({ error: 'Invalid invite type' }, 400);
  }

  const existing = await db.getUserByEmail(userEmail);
  if (existing) {
    return c.json({ error: 'Account already exists for this email' }, 409);
  }

  const username = rawUsername ? rawUsername.toLowerCase() : generateUsername();
  if (rawUsername) {
    const usernameErr = validateUsername(rawUsername);
    if (usernameErr) return c.json({ error: usernameErr }, 400);
    const existingUsername = await db.getUserByUsername(rawUsername);
    if (existingUsername) return c.json({ error: 'Username already taken' }, 409);
  }

  // For link invites, increment usage count BEFORE creating the user.
  // The atomic operation must gate account creation to prevent orphaned accounts
  // when the usage limit is reached during concurrent signups.
  if (invite.isLink) {
    try {
      await db.incrementLinkUsage(inviteToken);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        // Usage limit reached - this is the authoritative check (atomic, race-free)
        return c.json({ error: 'This invite link has reached its usage limit' }, 400);
      }
      throw err;
    }
  }

  const userId = generateUserId();
  const passwordHash = await hashPassword(password);

  await db.createUser({
    userId,
    email: userEmail,
    username,
    passwordHash,
    name,
    userGroup: userGroup || null,
    role: 'user',
    slackUserId: invite.slackUserId || null,
  });

  await emitHook('userCreated', { userId, email: userEmail, role: 'user' });

  // Mark invite as used after successful user creation
  if (invite.isLink) {
    // Check if we should mark the invite as used (maxUsages reached)
    const updated = await db.getInvite(inviteToken);
    if (updated.maxUsages && updated.usageCount >= updated.maxUsages) {
      await db.markInviteUsed(inviteToken);
    }
  } else {
    // Email-specific invites are marked as used immediately
    await db.markInviteUsed(inviteToken);
  }

  const accessToken = await signAccessToken(userId, 'user');
  const refreshToken = generateRefreshToken();
  await db.storeRefreshToken(hashToken(refreshToken), userId);

  return c.json({
    accessToken,
    refreshToken,
    user: { userId, email: userEmail, username, name, role: 'user' },
  }, 201);
});

// POST /v1/auth/login
auth.post('/v1/auth/login', async (c) => {
  const { email, password } = await c.req.json();

  if (!email || !password) {
    return c.json({ error: 'Email/username and password are required' }, 400);
  }

  // If the identifier contains @, look up by email; otherwise by username
  const user = email.includes('@')
    ? await db.getUserByEmail(email)
    : await db.getUserByUsername(email);
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const accessToken = await signAccessToken(user.userId, user.role);
  const refreshToken = generateRefreshToken();
  await db.storeRefreshToken(hashToken(refreshToken), user.userId);

  // Activity-tracking writes are best-effort: login must succeed even if
  // audit-log / user-record writes are throttled or unavailable. The login
  // itself is what users feel; missing activity data just degrades admin
  // stats for this user.
  try {
    await db.createAuditLog({
      action: 'user_login',
      userId: user.userId,
      email: user.email,
      performedBy: user.userId,
    });
  } catch { /* swallow */ }
  try {
    await db.setUserActivityField(user.userId, 'lastActiveAt', new Date().toISOString());
  } catch { /* swallow */ }

  return c.json({
    accessToken,
    refreshToken,
    user: { userId: user.userId, email: user.email, username: user.username, name: user.name, role: user.role },
  });
});

// POST /v1/auth/refresh
auth.post('/v1/auth/refresh', async (c) => {
  const { refreshToken } = await c.req.json();
  if (!refreshToken) {
    return c.json({ error: 'refreshToken is required' }, 400);
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await db.getRefreshToken(tokenHash);
  if (!stored) {
    return c.json({ error: 'Invalid refresh token' }, 401);
  }

  const user = await db.getUserById(stored.userId);
  if (!user) {
    await db.deleteRefreshToken(tokenHash);
    return c.json({ error: 'User not found' }, 401);
  }

  // Rotate: delete old, issue new
  await db.deleteRefreshToken(tokenHash);
  const newRefreshToken = generateRefreshToken();
  await db.storeRefreshToken(hashToken(newRefreshToken), user.userId);

  const accessToken = await signAccessToken(user.userId, user.role);

  // Best-effort: a token refresh fires every ~15 min while a learner is
  // active, so this gives `lastActiveAt` a heartbeat without per-message
  // write amplification on the user record.
  try {
    await db.setUserActivityField(user.userId, 'lastActiveAt', new Date().toISOString());
  } catch { /* swallow */ }

  return c.json({ accessToken, refreshToken: newRefreshToken });
});

// POST /v1/auth/logout
auth.post('/v1/auth/logout', async (c) => {
  const { refreshToken } = await c.req.json();
  if (refreshToken) {
    await db.deleteRefreshToken(hashToken(refreshToken));
  }
  return c.json({ ok: true });
});

// POST /v1/auth/forgot-password
auth.post('/v1/auth/forgot-password', async (c) => {
  const { email } = await c.req.json();
  if (!email) {
    return c.json({ error: 'Email is required' }, 400);
  }

  const user = await db.getUserByEmail(email);
  // Always return ok to avoid leaking whether an email exists
  if (!user) {
    return c.json({ ok: true });
  }

  const token = generateResetToken();
  await db.storeResetToken(hashToken(token), user.userId);
  await sendResetEmail(user.email, token);

  return c.json({ ok: true });
});

// POST /v1/auth/reset-password
auth.post('/v1/auth/reset-password', async (c) => {
  const { resetToken, password } = await c.req.json();
  if (!resetToken || !password) {
    return c.json({ error: 'resetToken and password are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const tokenHash = hashToken(resetToken);
  const stored = await db.getResetToken(tokenHash);
  if (!stored) {
    return c.json({ error: 'Invalid or expired reset link' }, 400);
  }

  const user = await db.getUserById(stored.userId);
  if (!user) {
    await db.deleteResetToken(tokenHash);
    return c.json({ error: 'User not found' }, 400);
  }

  const passwordHash = await hashPassword(password);
  await db.updateUser(user.userId, { passwordHash });
  await db.deleteResetToken(tokenHash);

  return c.json({ ok: true });
});

export default auth;
export { validateUsername, generateUsername };
