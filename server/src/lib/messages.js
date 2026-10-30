/**
 * Admin messages (#389): one-off announcements to everyone, a group, or
 * specific people, shown in the classroom (the bell, and optionally a pop-up
 * at sign-in) and/or emailed.
 *
 * A message is `_system:message:<id>` =
 *   { subject, body, audience: { type: 'all' | 'group' | 'users', group?, userIds? },
 *     inApp, email, important, status: 'sending' | 'sent', counts?, createdAt, createdBy, createdByName }
 *
 * "Everyone" and a group mean **learners** (participants); specific people
 * can be anyone. In-app delivery is computed at read time from the audience
 * (and, for everyone/group messages, only learners who joined before it was
 * sent), so nothing is written per recipient. Read state lives in the
 * learner's server-only `notify:state` (`read: { [messageId]: iso }`).
 * Email goes out in the `send-message` background job (lib/jobs.js),
 * honoring the `messages` opt-out.
 */
import { randomBytes } from 'node:crypto';
import defaultDb from './db.js';
import { normalizeRole } from './permissions.js';
import { nameFields } from './names.js';
import { APP_URL } from '../config.js';
import { getClassroom, escapeHtml } from './email.js';
import {
  validateTemplate, renderEmail, sendNotificationEmail, readNotifyState, updateNotifyState,
  unsubscribeUrl, UNSUBSCRIBE_KINDS,
} from './notifications.js';
import { registerJob } from './jobs.js';

export const MESSAGE_VARIABLES = ['firstName', 'classroomName'];
const MAX_RECIPIENTS_LISTED = 500;
const SEND_CONCURRENCY = 5;

export const newMessageId = () => `msg_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

/** Check a draft. Returns `{ message }` (normalized) or `{ error }`. */
export function validateMessage(body, { groups = [] } = {}) {
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body?.body === 'string' ? body.body.replace(/\r\n/g, '\n').trim() : '';
  const err = validateTemplate(null, { subject, body: text }, MESSAGE_VARIABLES);
  if (err) return { error: err };
  const inApp = body.inApp === true;
  const email = body.email === true;
  if (!inApp && !email) return { error: 'Choose in-app, email, or both' };
  const a = body.audience || {};
  let audience;
  if (a.type === 'all') audience = { type: 'all' };
  else if (a.type === 'group') {
    if (!groups.includes(a.group)) return { error: 'Choose one of the classroom’s groups' };
    audience = { type: 'group', group: a.group };
  } else if (a.type === 'users') {
    const ids = [...new Set((Array.isArray(a.userIds) ? a.userIds : []).filter((x) => typeof x === 'string'))];
    if (!ids.length) return { error: 'Choose at least one person' };
    if (ids.length > MAX_RECIPIENTS_LISTED) return { error: `Choose at most ${MAX_RECIPIENTS_LISTED} people, or send to a group` };
    audience = { type: 'users', userIds: ids };
  } else {
    return { error: 'Choose who gets this message' };
  }
  return { message: { subject, body: text, audience, inApp, email, important: inApp && body.important === true } };
}

/** Is this user one of the message's recipients? */
export function isRecipient(message, user) {
  const a = message.audience || {};
  if (a.type === 'users') return a.userIds.includes(user.userId);
  if (normalizeRole(user.role) !== 'learner') return false;
  // Learners who joined later don't get older broadcasts.
  if (user.createdAt && message.createdAt && user.createdAt > message.createdAt) return false;
  return a.type === 'all' || (a.type === 'group' && user.userGroup === a.group);
}

export async function recipientsOf(message, db = defaultDb) {
  const users = await db.listAllUsers();
  return users.filter((u) => isRecipient(message, u));
}

/** For the compose screen: how many people, and how many have turned email off. */
export async function previewAudience(audience, db = defaultDb) {
  const now = new Date().toISOString();
  const people = await recipientsOf({ audience, createdAt: now }, db);
  let optedOut = 0;
  for (const u of people) if ((await readNotifyState(u.userId, db)).optOut?.messages) optedOut++;
  return { count: people.length, emailOptedOut: optedOut, sample: people.slice(0, 5).map((u) => nameFields(u).name || u.email) };
}

export async function createMessage(message, actor, db = defaultDb) {
  const id = newMessageId();
  const record = {
    ...message,
    status: message.email ? 'sending' : 'sent',
    counts: { recipients: (await recipientsOf({ ...message, createdAt: new Date().toISOString() }, db)).length },
    createdAt: new Date().toISOString(),
    createdBy: actor.userId,
    createdByName: nameFields(actor).name || actor.username || actor.email,
  };
  await db.createSyncData('_system', `message:${id}`, record);
  return { id, ...record };
}

export async function listMessages(db = defaultDb) {
  const items = await db.getAllSyncData('_system');
  return items.filter((i) => i.dataKey.startsWith('message:'))
    .map((i) => ({ id: i.dataKey.slice('message:'.length), ...i.data }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** The in-app messages a user can see, newest first, with `read`. */
export async function messagesFor(user, db = defaultDb) {
  const [all, state, classroom] = await Promise.all([listMessages(db), readNotifyState(user.userId, db), getClassroom()]);
  const read = state.read || {};
  const vars = { firstName: nameFields(user).firstName, classroomName: classroom.name };
  return all.filter((m) => m.inApp && isRecipient(m, user)).slice(0, 50).map((m) => ({
    id: m.id, subject: fill(m.subject, vars), body: fill(m.body, vars),
    important: !!m.important, createdAt: m.createdAt, fromName: m.createdByName, read: !!read[m.id],
  }));
}

export async function markRead(userId, ids, db = defaultDb) {
  const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x.startsWith('msg_')).slice(0, 100);
  if (!clean.length) return { read: 0 };
  const now = new Date().toISOString();
  await updateNotifyState(userId, (s) => ({ ...s, read: { ...(s.read || {}), ...Object.fromEntries(clean.map((id) => [id, now])) } }), db);
  return { read: clean.length };
}

const fill = (s, vars) => s.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));

/** The `send-message` job: email every recipient, a few at a time, then record counts. */
export async function sendMessageEmails({ id }, { db = defaultDb, send } = {}) {
  const item = await db.getSyncData('_system', `message:${id}`);
  if (!item || !item.data.email || item.data.status === 'sent') return { skipped: true };
  const message = item.data;
  const [people, classroom] = await Promise.all([recipientsOf(message, db), getClassroom()]);
  const counts = { recipients: people.length, emailed: 0, optedOut: 0, blocked: 0, skipped: 0, failed: 0 };
  const queue = [...people];
  async function worker() {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try {
        if ((await readNotifyState(u.userId, db)).optOut?.messages) { counts.optedOut++; continue; }
        const unsubscribe = unsubscribeUrl(u.userId, 'messages');
        const label = UNSUBSCRIBE_KINDS.messages;
        const rendered = renderEmail(message, { firstName: nameFields(u).firstName, classroomName: classroom.name, link: APP_URL }, {
          classroom,
          footerText: `To stop getting ${label} by email, unsubscribe: ${unsubscribe}`,
          footerHtml: `<p style="color: #777; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">Don’t want ${escapeHtml(label)} by email? <a href="${escapeHtml(unsubscribe)}" style="color: #777;">Unsubscribe</a>.</p>`,
        });
        const r = await sendNotificationEmail({ to: u.email, ...rendered, classroom, unsubscribe, ...(send ? { send } : {}) });
        if (r.sent) counts.emailed++;
        else if (r.blocked) counts.blocked++;
        else counts.skipped++;
      } catch {
        counts.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));
  const latest = await db.getSyncData('_system', `message:${id}`);
  await db.putSyncData('_system', `message:${id}`, { ...latest.data, status: 'sent', counts, sentAt: new Date().toISOString() }, latest.version);
  return counts;
}

registerJob('send-message', (payload) => sendMessageEmails(payload));
