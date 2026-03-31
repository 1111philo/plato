/**
 * SQLite database module for 1111 Learn.
 * Uses sql.js (WASM) with persistence via platform abstraction.
 * Screenshots remain in IndexedDB — only referenced by key in the drafts table.
 */

import { resolveAssetURL, kvStorage } from './platform.js';

const DB_STORAGE_KEY = '_sqliteDb';
const PERSIST_DEBOUNCE_MS = 1000;

let _db = null;
let _dirty = false;
let _persistTimer = null;

// -- Schema -------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS profile_summary (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  summary TEXT NOT NULL DEFAULT '',
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS course_kbs (
  course_id TEXT PRIMARY KEY,
  kb TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS activity_kbs (
  activity_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  kb TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  activity_number INTEGER NOT NULL,
  instruction TEXT,
  tips TEXT,
  objective_focus TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id),
  course_id TEXT NOT NULL,
  screenshot_key TEXT,
  text_response TEXT,
  url TEXT,
  achieved INTEGER DEFAULT 0,
  demonstrates TEXT,
  moved TEXT,
  needed TEXT,
  strengths TEXT,
  attempt INTEGER DEFAULT 1,
  timestamp INTEGER
);

CREATE INDEX IF NOT EXISTS idx_drafts_activity ON drafts(activity_id);
CREATE INDEX IF NOT EXISTS idx_drafts_course ON drafts(course_id);

CREATE TABLE IF NOT EXISTS courses (
  course_id TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT,
  refresh_token TEXT,
  user_json TEXT
);

CREATE TABLE IF NOT EXISTS pending_state (
  key TEXT PRIMARY KEY,
  state_json TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS course_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  msg_type TEXT NOT NULL,
  phase TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_msg_course
  ON course_messages(course_id, timestamp);

`;

// -- Initialization -----------------------------------------------------------

export async function init() {
  const SQL = await globalThis.initSqlJs({
    locateFile: file => resolveAssetURL(`lib/${file}`),
  });

  const stored = await kvStorage.get(DB_STORAGE_KEY);
  if (stored[DB_STORAGE_KEY]) {
    _db = new SQL.Database(new Uint8Array(stored[DB_STORAGE_KEY]));
    _db.run(SCHEMA_SQL);
    _dirty = true;
  } else {
    _db = new SQL.Database();
    _db.run(SCHEMA_SQL);
    _dirty = true;
    await persist();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _dirty) {
      persist();
    }
  });
}

// -- Query API ----------------------------------------------------------------

export function run(sql, params = []) {
  _db.run(sql, params);
  _dirty = true;
  schedulePersist();
}

export function exec(sql) {
  _db.exec(sql);
  _dirty = true;
  schedulePersist();
}

export function query(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function queryAll(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// -- Persistence --------------------------------------------------------------

function schedulePersist() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persist();
  }, PERSIST_DEBOUNCE_MS);
}

export async function persist() {
  if (!_db) return;
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  const data = _db.export();
  await kvStorage.set({ [DB_STORAGE_KEY]: Array.from(data) });
  _dirty = false;
}

export function getDb() {
  return _db;
}

export async function clearAllData() {
  if (_db) {
    _db.close();
  }
  _db = null;
  _dirty = false;
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  await kvStorage.remove(DB_STORAGE_KEY);
}
