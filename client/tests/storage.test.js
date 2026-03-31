import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

// -- Setup: initialize sql.js and wire up db.js functions in-process ----------

let SQL;
let _db;

// No chrome mock needed — platform.js uses IndexedDB on web (not available in
// Node tests, but storage.test.js tests the SQLite layer directly, not persistence).

function run(sql, params = []) { _db.run(sql, params); }
function query(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free();
  return null;
}
function queryAll(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// -- Schema (matches db.js) ---------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profile_summary (id INTEGER PRIMARY KEY CHECK (id = 1), summary TEXT NOT NULL DEFAULT '', updated_at INTEGER);
CREATE TABLE IF NOT EXISTS course_kbs (course_id TEXT PRIMARY KEY, kb TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS activity_kbs (activity_id TEXT PRIMARY KEY, course_id TEXT NOT NULL, kb TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, activity_number INTEGER NOT NULL, instruction TEXT, tips TEXT, objective_focus TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id), course_id TEXT NOT NULL, screenshot_key TEXT, text_response TEXT, url TEXT, achieved INTEGER DEFAULT 0, demonstrates TEXT, moved TEXT, needed TEXT, strengths TEXT, attempt INTEGER DEFAULT 1, timestamp INTEGER);
CREATE INDEX IF NOT EXISTS idx_drafts_activity ON drafts(activity_id);
CREATE INDEX IF NOT EXISTS idx_drafts_course ON drafts(course_id);
CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT, refresh_token TEXT, user_json TEXT);
CREATE TABLE IF NOT EXISTS pending_state (key TEXT PRIMARY KEY, state_json TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS courses (course_id TEXT PRIMARY KEY, markdown TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS course_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', msg_type TEXT NOT NULL, phase TEXT, metadata TEXT, timestamp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_course_msg_course ON course_messages(course_id, timestamp);
`;

beforeEach(async () => {
  if (!SQL) SQL = await initSqlJs();
  _db = new SQL.Database();
  _db.run(SCHEMA_SQL);
});

// -- Tests --------------------------------------------------------------------

describe('SQLite schema', () => {
  it('creates all tables without error', () => {
    const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = tables.map(t => t.name);
    assert.ok(names.includes('settings'));
    assert.ok(names.includes('courses'));
    assert.ok(names.includes('course_kbs'));
    assert.ok(names.includes('activity_kbs'));
    assert.ok(names.includes('activities'));
    assert.ok(names.includes('drafts'));
    assert.ok(names.includes('profile'));
    assert.ok(names.includes('course_messages'));
  });
});

describe('settings (key-value)', () => {
  it('stores and retrieves a setting', () => {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('apiKey', ?)", [JSON.stringify('sk-test')]);
    const row = query("SELECT value FROM settings WHERE key = 'apiKey'");
    assert.equal(JSON.parse(row.value), 'sk-test');
  });

  it('returns null for missing setting', () => {
    const row = query("SELECT value FROM settings WHERE key = 'missing'");
    assert.equal(row, null);
  });
});

describe('preferences (singleton)', () => {
  it('round-trips preferences', () => {
    const prefs = { name: 'Blake' };
    run('INSERT OR REPLACE INTO preferences (id, data, updated_at) VALUES (1, ?, ?)',
      [JSON.stringify(prefs), Date.now()]);
    const row = query('SELECT data FROM preferences WHERE id = 1');
    assert.deepEqual(JSON.parse(row.data), prefs);
  });
});

describe('profile', () => {
  it('round-trips learner profile', () => {
    const profile = { name: 'Blake', goal: 'Learn web dev', strengths: ['css'], weaknesses: [] };
    run('INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (1, ?, ?)',
      [JSON.stringify(profile), Date.now()]);
    const row = query('SELECT data FROM profile WHERE id = 1');
    assert.deepEqual(JSON.parse(row.data), profile);
  });
});

describe('course KB', () => {
  it('round-trips a course knowledge base', () => {
    const courseId = 'foundations';
    const kb = {
      exemplar: 'A professional portfolio...',
      objectives: [{ objective: 'Can identify values', evidence: 'Written reflection' }],
      learnerPosition: 'New learner',
      insights: ['Strong writer'],
      activitiesCompleted: 3,
      status: 'active',
    };

    run('INSERT INTO course_kbs (course_id, kb, updated_at) VALUES (?, ?, ?)',
      [courseId, JSON.stringify(kb), Date.now()]);

    const row = query('SELECT * FROM course_kbs WHERE course_id = ?', [courseId]);
    assert.deepEqual(JSON.parse(row.kb), kb);
  });
});

describe('activity KB', () => {
  it('round-trips an activity knowledge base', () => {
    const activityId = 'foundations-act-1';
    const courseId = 'foundations';
    const kb = {
      courseId,
      activityNumber: 1,
      instruction: 'Write about your values.',
      tips: ['Be specific'],
      attempts: [{ attempt: 1, achieved: false, demonstrates: 'Basic reflection' }],
    };

    run('INSERT INTO activity_kbs (activity_id, course_id, kb, updated_at) VALUES (?, ?, ?, ?)',
      [activityId, courseId, JSON.stringify(kb), Date.now()]);

    const row = query('SELECT * FROM activity_kbs WHERE activity_id = ?', [activityId]);
    assert.deepEqual(JSON.parse(row.kb), kb);
  });
});

describe('activities', () => {
  it('stores and retrieves activities in order', () => {
    run(
      'INSERT INTO activities (id, course_id, activity_number, instruction, tips, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['foundations-act-1', 'foundations', 1, 'Write about values.', JSON.stringify(['Be specific']), 1000]
    );
    run(
      'INSERT INTO activities (id, course_id, activity_number, instruction, tips, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['foundations-act-2', 'foundations', 2, 'Build your tech stack.', JSON.stringify(['List tools']), 2000]
    );

    const rows = queryAll('SELECT * FROM activities WHERE course_id = ? ORDER BY activity_number', ['foundations']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].activity_number, 1);
    assert.equal(rows[1].instruction, 'Build your tech stack.');
  });
});

describe('drafts', () => {
  it('stores and retrieves drafts for a course', () => {
    run(
      'INSERT INTO activities (id, course_id, activity_number, instruction, created_at) VALUES (?, ?, ?, ?, ?)',
      ['foundations-act-1', 'foundations', 1, 'Write.', 1000]
    );

    run(
      `INSERT INTO drafts (id, activity_id, course_id, text_response, achieved, demonstrates, needed, strengths, attempt, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['draft-1', 'foundations-act-1', 'foundations', 'My reflection on values.',
       0, 'Basic value identification.', 'Connect to professional context.',
       JSON.stringify(['Clear writing']), 1, 1000]
    );

    const rows = queryAll('SELECT * FROM drafts WHERE course_id = ? ORDER BY timestamp', ['foundations']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].demonstrates, 'Basic value identification.');
    assert.deepEqual(JSON.parse(rows[0].strengths), ['Clear writing']);
    assert.equal(rows[0].achieved, 0);
  });
});

describe('auth (singleton)', () => {
  it('stores and retrieves auth tokens', () => {
    run('INSERT INTO auth (id, access_token, refresh_token, user_json) VALUES (1, ?, ?, ?)',
      ['at-123', 'rt-456', JSON.stringify({ email: 'test@test.com' })]);

    const row = query('SELECT * FROM auth WHERE id = 1');
    assert.equal(row.access_token, 'at-123');
    assert.deepEqual(JSON.parse(row.user_json), { email: 'test@test.com' });
  });
});

describe('pending state', () => {
  it('stores and retrieves pending state', () => {
    const state = { name: 'Test' };
    run('INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES (?, ?, ?)',
      ['onboarding', JSON.stringify(state), Date.now()]);

    const row = query("SELECT state_json FROM pending_state WHERE key = 'onboarding'");
    assert.deepEqual(JSON.parse(row.state_json), state);
  });

  it('clears pending state', () => {
    run("INSERT INTO pending_state (key, state_json) VALUES ('onboarding', ?)", [JSON.stringify({})]);
    run("DELETE FROM pending_state WHERE key = 'onboarding'");
    const row = query("SELECT * FROM pending_state WHERE key = 'onboarding'");
    assert.equal(row, null);
  });
});

describe('course messages', () => {
  it('stores and retrieves course messages in order', () => {
    run(
      `INSERT INTO course_messages (course_id, role, content, msg_type, phase, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['foundations', 'assistant', 'Welcome!', 'guide', 'course_intro', null, 1000]
    );
    run(
      `INSERT INTO course_messages (course_id, role, content, msg_type, phase, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['foundations', 'assistant', '', 'instruction', 'learning', JSON.stringify({ activityId: 'act-1' }), 2000]
    );

    const rows = queryAll(
      'SELECT * FROM course_messages WHERE course_id = ? ORDER BY timestamp',
      ['foundations']
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].content, 'Welcome!');
    assert.equal(rows[0].msg_type, 'guide');
    assert.equal(rows[1].msg_type, 'instruction');
    assert.deepEqual(JSON.parse(rows[1].metadata), { activityId: 'act-1' });
  });

  it('clears course messages', () => {
    run(
      `INSERT INTO course_messages (course_id, role, content, msg_type, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      ['test-clear', 'assistant', 'Hello', 'guide', 1000]
    );
    run('DELETE FROM course_messages WHERE course_id = ?', ['test-clear']);
    const rows = queryAll('SELECT * FROM course_messages WHERE course_id = ?', ['test-clear']);
    assert.equal(rows.length, 0);
  });
});

describe('user-created courses', () => {
  it('stores and retrieves a user course', () => {
    const md = '# My Course\n\nA test course.\n\n## Exemplar\nSomething great.\n\n## Learning Objectives\n- Can do X\n- Can do Y';
    run('INSERT INTO courses (course_id, markdown, created_at) VALUES (?, ?, ?)',
      ['custom-123', md, 1000]);

    const rows = queryAll('SELECT * FROM courses');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].course_id, 'custom-123');
    assert.ok(rows[0].markdown.includes('My Course'));
  });
});

