/**
 * SQLite backend for plato.
 * Drop-in replacement for db-dynamodb.js — same function signatures and return shapes.
 * Uses better-sqlite3 (synchronous API).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  REFRESH_TOKEN_TTL_DAYS, INVITE_TTL_DAYS, RESET_TOKEN_TTL_HOURS,
} from '../config.js';

const SQLITE_PATH = process.env.SQLITE_PATH || './data/plato.db';

// Ensure directory exists
const dir = dirname(SQLITE_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(SQLITE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// -- Schema -------------------------------------------------------------------

sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  username TEXT UNIQUE COLLATE NOCASE,
  passwordHash TEXT NOT NULL,
  name TEXT,
  userGroup TEXT,
  role TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  inviteToken TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  invitedBy TEXT,
  status TEXT DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  usedAt TEXT,
  ttl INTEGER
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  tokenHash TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT DEFAULT 'refresh',
  createdAt TEXT NOT NULL,
  ttl INTEGER
);

CREATE TABLE IF NOT EXISTS sync_data (
  userId TEXT NOT NULL,
  dataKey TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (userId, dataKey)
);

CREATE TABLE IF NOT EXISTS audit_log (
  logId TEXT PRIMARY KEY,
  action TEXT,
  userId TEXT,
  email TEXT,
  performedBy TEXT,
  details TEXT,
  createdAt TEXT NOT NULL
);
`);

// -- Migrations ---------------------------------------------------------------

// Add username column if missing (existing databases created before username support)
const hasUsername = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name = 'username'"
).get();
if (hasUsername.count === 0) {
  sqlite.exec('ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE');
}
// Ensure unique index exists (SQLite ALTER TABLE cannot add UNIQUE columns directly)
sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL');

// Backfill any users missing a username with a random one
{
  const missing = sqlite.prepare('SELECT userId FROM users WHERE username IS NULL').all();
  if (missing.length > 0) {
    const { randomBytes } = await import('node:crypto');
    const update = sqlite.prepare('UPDATE users SET username = ? WHERE userId = ?');
    for (const { userId } of missing) {
      const username = 'user-' + randomBytes(3).toString('hex');
      update.run(username, userId);
    }
  }
}

// Add slackUserId column to users if missing
const hasSlackUser = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name = 'slackUserId'"
).get();
if (hasSlackUser.count === 0) {
  sqlite.exec('ALTER TABLE users ADD COLUMN slackUserId TEXT');
}

// Denormalized stat fields for the Admin → Users table (#136). Maintained
// by the sync route's PUT hooks; backfilled lazily by the admin stats
// endpoint when missing.
const hasLessonsCompleted = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name = 'lessonsCompleted'"
).get();
if (hasLessonsCompleted.count === 0) {
  sqlite.exec('ALTER TABLE users ADD COLUMN lessonsCompleted INTEGER');
}
const hasLastActiveAt = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name = 'lastActiveAt'"
).get();
if (hasLastActiveAt.count === 0) {
  sqlite.exec('ALTER TABLE users ADD COLUMN lastActiveAt TEXT');
}

// Add slackUserId column to invites if missing
const hasSlackInvite = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('invites') WHERE name = 'slackUserId'"
).get();
if (hasSlackInvite.count === 0) {
  sqlite.exec('ALTER TABLE invites ADD COLUMN slackUserId TEXT');
}

// Add link invite columns if missing
const hasIsLink = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('invites') WHERE name = 'isLink'"
).get();
if (hasIsLink.count === 0) {
  sqlite.exec('ALTER TABLE invites ADD COLUMN isLink INTEGER DEFAULT 0');
}
const hasUsageCount = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('invites') WHERE name = 'usageCount'"
).get();
if (hasUsageCount.count === 0) {
  sqlite.exec('ALTER TABLE invites ADD COLUMN usageCount INTEGER DEFAULT 0');
}
const hasMaxUsages = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('invites') WHERE name = 'maxUsages'"
).get();
if (hasMaxUsages.count === 0) {
  sqlite.exec('ALTER TABLE invites ADD COLUMN maxUsages INTEGER');
}
// Make email nullable for link invites
// SQLite doesn't support ALTER COLUMN, so we need to recreate the table
// Check if email is still NOT NULL
const emailNotNull = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('invites') WHERE name = 'email' AND \"notnull\" = 1"
).get();

if (emailNotNull.count > 0) {
  // Need to migrate: recreate table with nullable email
  sqlite.exec(`
    -- Create new table with nullable email
    CREATE TABLE invites_new (
      inviteToken TEXT PRIMARY KEY,
      email TEXT COLLATE NOCASE,
      invitedBy TEXT,
      slackUserId TEXT,
      status TEXT DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      usedAt TEXT,
      ttl INTEGER,
      isLink INTEGER DEFAULT 0,
      usageCount INTEGER DEFAULT 0,
      maxUsages INTEGER
    );

    -- Copy existing data
    INSERT INTO invites_new (inviteToken, email, invitedBy, slackUserId, status, createdAt, usedAt, ttl, isLink, usageCount, maxUsages)
    SELECT inviteToken, email, invitedBy, slackUserId, status, createdAt, usedAt, ttl,
           COALESCE(isLink, 0), COALESCE(usageCount, 0), maxUsages
    FROM invites;

    -- Drop old table and rename new one
    DROP TABLE invites;
    ALTER TABLE invites_new RENAME TO invites;
  `);
}

// -- TTL cleanup (runs on startup and periodically) ---------------------------

function cleanupExpired() {
  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare('DELETE FROM invites WHERE ttl < ?').run(now);
  sqlite.prepare('DELETE FROM refresh_tokens WHERE ttl < ?').run(now);
}

cleanupExpired();
const _cleanupTimer = setInterval(cleanupExpired, 60 * 60 * 1000); // hourly
_cleanupTimer.unref(); // don't keep process alive

// -- Helper: ConditionalCheckFailedException ----------------------------------

function conditionalCheckFailed(message) {
  const err = new Error(message || 'The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

// -- Database operations (same API as db-dynamodb.js) -------------------------

const db = {
  // ── Users ──

  async createUser({ userId, email, passwordHash, name, username, userGroup, role, slackUserId }) {
    const now = new Date().toISOString();
    const result = sqlite.prepare(
      `INSERT OR IGNORE INTO users (userId, email, username, passwordHash, name, userGroup, role, slackUserId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, email.toLowerCase(), username || null, passwordHash, name, userGroup || null, role, slackUserId || null, now, now);
    if (result.changes === 0) throw conditionalCheckFailed('User already exists');
  },

  async getUserById(userId) {
    return sqlite.prepare('SELECT * FROM users WHERE userId = ?').get(userId) || null;
  },

  async getUserByEmail(email) {
    return sqlite.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) || null;
  },

  async getUserByUsername(username) {
    return sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase()) || null;
  },

  async updateUser(userId, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    values.push(new Date().toISOString(), userId);
    sqlite.prepare(`UPDATE users SET ${sets}, updatedAt = ? WHERE userId = ?`).run(...values);
  },

  async deleteUser(userId) {
    sqlite.prepare('DELETE FROM users WHERE userId = ?').run(userId);
  },

  // Lightweight writes used by the sync-route hooks. They deliberately do
  // NOT touch updatedAt — these are activity-tracking side effects, not
  // user-profile edits.
  async incrementUserCounter(userId, field, delta = 1) {
    if (!['lessonsCompleted'].includes(field)) throw new Error(`Unsupported counter field: ${field}`);
    sqlite.prepare(`UPDATE users SET ${field} = COALESCE(${field}, 0) + ? WHERE userId = ?`).run(delta, userId);
  },

  async setUserActivityField(userId, field, value) {
    if (!['lastActiveAt', 'lessonsCompleted'].includes(field)) throw new Error(`Unsupported activity field: ${field}`);
    sqlite.prepare(`UPDATE users SET ${field} = ? WHERE userId = ?`).run(value, userId);
  },

  async listUsers() {
    return sqlite.prepare("SELECT * FROM users WHERE role = 'user'").all();
  },

  async listAllUsers() {
    return sqlite.prepare('SELECT * FROM users').all();
  },

  async countUsers() {
    const row = sqlite.prepare('SELECT COUNT(*) as count FROM users').get();
    return row.count;
  },

  // ── Invites ──

  async createInvite({ inviteToken, email, invitedBy, slackUserId, isLink = false, usageCount = 0, maxUsages = null }) {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + INVITE_TTL_DAYS * 86400;
    sqlite.prepare(
      `INSERT INTO invites (inviteToken, email, invitedBy, slackUserId, status, createdAt, ttl, isLink, usageCount, maxUsages)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    ).run(
      inviteToken,
      email ? email.toLowerCase() : null,
      invitedBy,
      slackUserId || null,
      now.toISOString(),
      ttl,
      isLink ? 1 : 0,
      usageCount,
      maxUsages
    );
  },

  async getInviteByEmail(email) {
    return sqlite.prepare(
      "SELECT * FROM invites WHERE email = ? AND status = 'pending' ORDER BY createdAt DESC LIMIT 1"
    ).get(email.toLowerCase()) || null;
  },

  async getInvite(inviteToken) {
    return sqlite.prepare('SELECT * FROM invites WHERE inviteToken = ?').get(inviteToken) || null;
  },

  async markInviteUsed(inviteToken) {
    sqlite.prepare(
      "UPDATE invites SET status = 'used', usedAt = ? WHERE inviteToken = ?"
    ).run(new Date().toISOString(), inviteToken);
  },

  async deleteInvite(inviteToken) {
    sqlite.prepare('DELETE FROM invites WHERE inviteToken = ?').run(inviteToken);
  },

  async listInvites() {
    return sqlite.prepare('SELECT * FROM invites').all();
  },

  async getInviteLinkToken() {
    const row = sqlite.prepare(
      "SELECT * FROM invites WHERE isLink = 1 AND status = 'pending' LIMIT 1"
    ).get();
    return row || null;
  },

  async incrementLinkUsage(inviteToken) {
    // Atomic increment with usage limit check to prevent race condition.
    // If maxUsages is set and would be exceeded, the update affects 0 rows.
    const result = sqlite.prepare(
      `UPDATE invites SET usageCount = usageCount + 1
       WHERE inviteToken = ?
       AND (maxUsages IS NULL OR usageCount < maxUsages)`
    ).run(inviteToken);

    if (result.changes === 0) {
      // Either token doesn't exist or maxUsages limit reached
      const invite = sqlite.prepare('SELECT * FROM invites WHERE inviteToken = ?').get(inviteToken);
      if (!invite) {
        // Token doesn't exist - match DynamoDB behavior (would throw on non-existent key)
        const err = new Error('Invite not found');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      if (invite.maxUsages && invite.usageCount >= invite.maxUsages) {
        const err = new Error('Usage limit reached');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      // If we get here, the WHERE clause failed for some other reason (not pending, etc.)
      // This is unreachable in normal flow (validated earlier in auth.js), so throw anyway
      const err = new Error('Could not increment usage count');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
  },

  // ── Refresh Tokens ──

  async storeRefreshToken(tokenHash, userId) {
    const ttl = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_DAYS * 86400;
    sqlite.prepare(
      `INSERT INTO refresh_tokens (tokenHash, userId, type, createdAt, ttl)
       VALUES (?, ?, 'refresh', ?, ?)`
    ).run(tokenHash, userId, new Date().toISOString(), ttl);
  },

  async getRefreshToken(tokenHash) {
    return sqlite.prepare('SELECT * FROM refresh_tokens WHERE tokenHash = ?').get(tokenHash) || null;
  },

  async deleteRefreshToken(tokenHash) {
    sqlite.prepare('DELETE FROM refresh_tokens WHERE tokenHash = ?').run(tokenHash);
  },

  // ── Reset Tokens (reuses refresh_tokens table) ──

  async storeResetToken(tokenHash, userId) {
    const ttl = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_HOURS * 3600;
    sqlite.prepare(
      `INSERT INTO refresh_tokens (tokenHash, userId, type, createdAt, ttl)
       VALUES (?, ?, 'reset', ?, ?)`
    ).run(tokenHash, userId, new Date().toISOString(), ttl);
  },

  async getResetToken(tokenHash) {
    const item = sqlite.prepare('SELECT * FROM refresh_tokens WHERE tokenHash = ?').get(tokenHash);
    if (!item || item.type !== 'reset') return null;
    return item;
  },

  async deleteResetToken(tokenHash) {
    sqlite.prepare('DELETE FROM refresh_tokens WHERE tokenHash = ?').run(tokenHash);
  },

  // ── Sync Data ──

  async getSyncData(userId, dataKey) {
    const row = sqlite.prepare(
      'SELECT * FROM sync_data WHERE userId = ? AND dataKey = ?'
    ).get(userId, dataKey);
    if (!row) return null;
    return { ...row, data: JSON.parse(row.data) };
  },

  async getAllSyncData(userId) {
    const rows = sqlite.prepare('SELECT * FROM sync_data WHERE userId = ?').all(userId);
    // Parse JSON data field
    return rows.map(r => ({ ...r, data: JSON.parse(r.data) }));
  },

  // Mirror of the DynamoDB sort-key prefix query: fetch only sync-data records
  // whose dataKey begins with `prefix` (e.g. 'lessonKB:'), so admin stats skip
  // the large screenshot:*/messages:* records.
  async getSyncDataByPrefix(userId, prefix) {
    const rows = sqlite.prepare(
      'SELECT * FROM sync_data WHERE userId = ? AND dataKey LIKE ? ESCAPE ?'
    ).all(userId, `${prefix.replace(/[%_\\]/g, '\\$&')}%`, '\\');
    return rows.map(r => ({ ...r, data: JSON.parse(r.data) }));
  },

  async putSyncData(userId, dataKey, data, expectedVersion) {
    const now = new Date().toISOString();
    const newVersion = (expectedVersion || 0) + 1;
    const jsonData = JSON.stringify(data);

    if (expectedVersion) {
      // Optimistic locking: only update if version matches or item doesn't exist
      const existing = sqlite.prepare(
        'SELECT version FROM sync_data WHERE userId = ? AND dataKey = ?'
      ).get(userId, dataKey);

      if (existing && existing.version !== expectedVersion) {
        throw conditionalCheckFailed('Version mismatch');
      }
    }

    sqlite.prepare(
      `INSERT INTO sync_data (userId, dataKey, data, version, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, dataKey) DO UPDATE SET data = ?, version = ?, updatedAt = ?`
    ).run(userId, dataKey, jsonData, newVersion, now, jsonData, newVersion, now);

    return { version: newVersion, updatedAt: now };
  },

  async deleteSyncData(userId, dataKey) {
    sqlite.prepare('DELETE FROM sync_data WHERE userId = ? AND dataKey = ?').run(userId, dataKey);
  },

  // ── Audit Log ──

  async createAuditLog({ action, userId, email, performedBy, details }) {
    const now = new Date().toISOString();
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sqlite.prepare(
      `INSERT INTO audit_log (logId, action, userId, email, performedBy, details, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(logId, action, userId, email, performedBy, details ? JSON.stringify(details) : null, now);
  },

  async listAuditLogsForUser(userId, sinceIso) {
    const rows = sinceIso
      ? sqlite.prepare('SELECT * FROM audit_log WHERE userId = ? AND createdAt >= ? ORDER BY createdAt DESC').all(userId, sinceIso)
      : sqlite.prepare('SELECT * FROM audit_log WHERE userId = ? ORDER BY createdAt DESC').all(userId);
    return rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  },
};

export default db;
