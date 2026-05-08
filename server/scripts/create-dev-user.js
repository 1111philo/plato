#!/usr/bin/env node
/**
 * Dev helper: create a learner directly in the SQLite db so you can log in
 * (and impersonate) without going through the email-invite flow.
 *
 * Usage (from server/):
 *   node scripts/create-dev-user.js <email> <password> [name]
 *
 * Defaults to the same SQLite file dev-sqlite.js uses, so the running dev
 * server sees the new user immediately.
 */
process.env.DB_BACKEND = process.env.DB_BACKEND || 'sqlite';
process.env.SQLITE_PATH = process.env.SQLITE_PATH || './data/plato-dev.db';

const db = (await import('../src/lib/db.js')).default;
const { hashPassword } = await import('../src/lib/password.js');

const [, , email, password, name] = process.argv;
if (!email || !password) {
  console.error('Usage: node scripts/create-dev-user.js <email> <password> [name]');
  process.exit(1);
}

const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const username = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '').toLowerCase();
const displayName = name || username;
const passwordHash = await hashPassword(password);

await db.createUser({
  userId,
  email,
  username,
  passwordHash,
  name: displayName,
  userGroup: null,
  role: 'user',
  slackUserId: null,
});

console.log(`Created user:\n  userId:   ${userId}\n  email:    ${email}\n  username: ${username}\n  name:     ${displayName}`);
process.exit(0);
