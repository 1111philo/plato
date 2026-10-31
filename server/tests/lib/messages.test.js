/**
 * Admin messages (#389, src/lib/messages.js) and background jobs
 * (src/lib/jobs.js), on real SQLite with the email transport swapped out.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';

const DB_PATH = './data/test-messages.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = DB_PATH;
const { default: db } = await import('../../src/lib/db-sqlite.js');
const m = await import('../../src/lib/messages.js');
const { setEmailTransport, setOptOut } = await import('../../src/lib/notifications.js');
const jobs = await import('../../src/lib/jobs.js');

const mails = [];
const USERS = [
  { userId: 'usr_ada', email: 'ada@x.com', name: 'Ada King', firstName: 'Ada', lastName: 'King', role: 'learner', userGroup: 'Cohort A' },
  { userId: 'usr_bo', email: 'bo@x.com', name: 'Bo', firstName: 'Bo', lastName: '', role: 'user', userGroup: 'Cohort B' }, // legacy role
  { userId: 'usr_ed', email: 'ed@x.com', name: 'Ed', firstName: 'Ed', lastName: '', role: 'educator', userGroup: 'Cohort A' },
];
const admin = { userId: 'usr_admin', email: 'admin@x.com', firstName: 'Ann', lastName: 'Admin', role: 'admin' };

before(async () => {
  setEmailTransport(async (raw) => { mails.push(raw); });
  for (const u of USERS) await db.createUser({ ...u, passwordHash: 'x' });
});
after(() => {
  setEmailTransport(null);
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f);
});
beforeEach(async () => {
  mails.length = 0;
  delete process.env.SKIP_EMAIL;
  for (const owner of ['_system', ...USERS.map((u) => u.userId)]) for (const i of await db.getAllSyncData(owner)) await db.deleteSyncData(owner, i.dataKey);
});

const draft = (over = {}) => ({ subject: 'Hello {{firstName}}', body: 'Welcome to {{classroomName}}.', inApp: true, email: false, audience: { type: 'all' }, ...over });

describe('validateMessage', () => {
  it('normalizes a valid draft; important needs in-app', () => {
    const { message } = m.validateMessage(draft({ important: true, email: true, inApp: false }));
    assert.deepEqual([message.inApp, message.email, message.important], [false, true, false]);
  });
  it('refuses missing channels, audiences, unknown groups, bad variables', () => {
    assert.match(m.validateMessage(draft({ inApp: false })).error, /in-app, email, or both/);
    assert.match(m.validateMessage(draft({ audience: {} })).error, /who gets/);
    assert.match(m.validateMessage(draft({ audience: { type: 'group', group: 'Nope' } }), { groups: ['Cohort A'] }).error, /groups/);
    assert.match(m.validateMessage(draft({ audience: { type: 'users', userIds: [] } })).error, /at least one/);
    assert.match(m.validateMessage(draft({ body: 'Hi {{lessonName}}' })).error, /Unknown variable/);
  });
});

describe('recipients', () => {
  it('everyone and groups mean learners (legacy role included); specific people can be anyone', async () => {
    const ids = async (audience) => (await m.recipientsOf({ audience, createdAt: new Date().toISOString() }, db)).map((u) => u.userId).sort();
    assert.deepEqual(await ids({ type: 'all' }), ['usr_ada', 'usr_bo']);
    assert.deepEqual(await ids({ type: 'group', group: 'Cohort A' }), ['usr_ada']);
    assert.deepEqual(await ids({ type: 'users', userIds: ['usr_ed', 'usr_nope'] }), ['usr_ed']);
  });
  it('learners who joined later don’t get older broadcasts', () => {
    const msg = { audience: { type: 'all' }, createdAt: '2026-01-01T00:00:00Z' };
    assert.equal(m.isRecipient(msg, { userId: 'u', role: 'learner', createdAt: '2026-02-01T00:00:00Z' }), false);
    assert.equal(m.isRecipient(msg, { userId: 'u', role: 'learner', createdAt: '2025-12-01T00:00:00Z' }), true);
  });
  it('preview counts people and email opt-outs', async () => {
    await setOptOut('usr_bo', { messages: true }, db);
    const p = await m.previewAudience({ type: 'all' }, db);
    assert.deepEqual([p.count, p.emailOptedOut], [2, 1]);
  });
});

describe('in-app messages', () => {
  it('shows a learner their messages with read state and their first name filled in', async () => {
    const { id } = await m.createMessage(m.validateMessage(draft({ important: true })).message, admin, db);
    await m.createMessage(m.validateMessage(draft({ inApp: false, email: true, subject: 'Email only' })).message, admin, db);
    let list = await m.messagesFor(await db.getUserById('usr_ada'), db);
    assert.equal(list.length, 1, 'email-only messages aren’t in the bell');
    assert.deepEqual([list[0].subject, list[0].body, list[0].important, list[0].read, list[0].fromName], ['Hello Ada', 'Welcome to plato.', true, false, 'Ann Admin']);
    assert.equal((await m.messagesFor(await db.getUserById('usr_ed'), db)).length, 0, 'educators aren’t in “everyone”');
    await m.markRead('usr_ada', [id, 'not-a-message'], db);
    list = await m.messagesFor(await db.getUserById('usr_ada'), db);
    assert.equal(list[0].read, true);
  });
});

describe('send-message job', () => {
  it('emails recipients with an unsubscribe link, skips opt-outs, records counts, and runs once', async () => {
    await setOptOut('usr_bo', { messages: true }, db);
    const msg = await m.createMessage(m.validateMessage(draft({ email: true })).message, admin, db);
    assert.equal(msg.status, 'sending');
    const counts = await m.sendMessageEmails({ id: msg.id }, { db });
    assert.deepEqual(counts, { recipients: 2, emailed: 1, optedOut: 1, blocked: 0, skipped: 0, failed: 0 });
    assert.equal(mails.length, 1);
    assert.match(mails[0], /^To: ada@x\.com$/m);
    assert.match(mails[0], /^Subject: Hello Ada$/m);
    assert.match(mails[0], /^List-Unsubscribe: </m);
    const stored = (await db.getSyncData('_system', `message:${msg.id}`)).data;
    assert.equal(stored.status, 'sent');
    assert.deepEqual(await m.sendMessageEmails({ id: msg.id }, { db }), { skipped: true }, 'a retried job sends nothing');
    assert.equal(mails.length, 1);
  });
  it('a retried job (Lambda retries failed async jobs) emails only who it missed', async () => {
    const msg = await m.createMessage(m.validateMessage(draft({ email: true })).message, admin, db);
    // First attempt: one of the two sends fails, then the run dies before recording the result.
    let calls = 0;
    setEmailTransport(async (raw) => { calls++; mails.push(raw); if (calls === 1) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    await m.sendMessageEmails({ id: msg.id }, { db }).catch(() => {});
    setEmailTransport(async (raw) => { mails.push(raw); });
    const before = mails.length;
    // Simulate the crash: the record never flipped to 'sent'.
    const rec = await db.getSyncData('_system', `message:${msg.id}`);
    await db.putSyncData('_system', `message:${msg.id}`, { ...rec.data, status: 'sending' }, rec.version);
    const counts = await m.sendMessageEmails({ id: msg.id }, { db });
    assert.equal(mails.length - before, 1, 'only the person whose send failed gets a retry');
    assert.equal(counts.emailed, 2);
  });

  it('an in-app-only message is sent at once and never emails', async () => {
    const msg = await m.createMessage(m.validateMessage(draft()).message, admin, db);
    assert.equal(msg.status, 'sent');
    assert.deepEqual(await m.sendMessageEmails({ id: msg.id }, { db }), { skipped: true });
  });
});

describe('jobs', () => {
  it('runs a registered job locally when not on Lambda; unknown jobs report an error', async () => {
    let ran = null;
    jobs.registerJob('test-job', async (p) => { ran = p; return { ok: true }; });
    assert.deepEqual(await jobs.dispatchJob('test-job', { a: 1 }), { local: true });
    await jobs.whenJobsIdle();
    assert.deepEqual(ran, { a: 1 });
    assert.deepEqual(await jobs.runJob('nope'), { error: 'unknown job' });
    assert.equal(jobs.isJobEvent({ __platoInternal: 'platoJob', job: 'x' }), true);
    assert.equal(jobs.isJobEvent({ __platoInternal: 'refreshLessonStats' }), false);
  });
});
