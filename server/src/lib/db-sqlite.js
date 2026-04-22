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

// Add slackUserId column to invites if missing
const hasSlackInvite = sqlite.prepare(
  "SELECT COUNT(*) as count FROM pragma_table_info('invites') WHERE name = 'slackUserId'"
).get();
if (hasSlackInvite.count === 0) {
  sqlite.exec('ALTER TABLE invites ADD COLUMN slackUserId TEXT');
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

  async createInvite({ inviteToken, email, invitedBy, slackUserId }) {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + INVITE_TTL_DAYS * 86400;
    sqlite.prepare(
      `INSERT INTO invites (inviteToken, email, invitedBy, slackUserId, status, createdAt, ttl)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).run(inviteToken, email.toLowerCase(), invitedBy, slackUserId || null, now.toISOString(), ttl);
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

  async putSyncData(userId, dataKey, data, expectedVersion) {
    const now = new Date().toISOString();
    const newVersion = (expectedVersion || 0) + 1;
    const jsonData = JSON.stringify(data);

    const existing = sqlite.prepare(
      'SELECT version FROM sync_data WHERE userId = ? AND dataKey = ?'
    ).get(userId, dataKey);

    if (expectedVersion === 0) {
      if (existing) throw conditionalCheckFailed('Version mismatch');
    } else if (!existing || existing.version !== expectedVersion) {
      throw conditionalCheckFailed('Version mismatch');
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
};

export default db;
