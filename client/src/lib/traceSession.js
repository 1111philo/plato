/**
 * Opens a Trace recorder for the signed-in person when Trace is on for a
 * conversation (#595). The impure half of lib/lessonTrace.js: it reads the
 * two switches (the person's own, per conversation, and the admin-set flag
 * for everything), writes records
 * through storage, and lets the Trace panel listen to a conversation as it
 * happens.
 *
 * `openTrace` resolves to `undefined` when Trace is off for the scope, which is what
 * every caller passes on as `trace`; nothing else in the app checks the
 * switches.
 */
import { getPreferences, getAuthUser, putTraceRecord, listTraceRecords } from '../../js/storage.js';
import { createTrace, isTraceOn, MAX_SCOPE_BYTES } from './lessonTrace.js';

/* global __PLATO_BUILD__ */
const BUILD = typeof __PLATO_BUILD__ === 'string' ? __PLATO_BUILD__ : 'dev';

// Prompt parts already stored, per scope, so each is written once a session.
const knownParts = new Map();
const listeners = new Map(); // scope -> Set<fn>
// How much each scope's trace holds (characters written), and which are full.
const scopeBytes = new Map();
const full = new Set();
// Scopes with no record of their own to carry the size (`profile`):
// what is already stored, read once a session.
const stored = new Map(); // scope -> Promise<number>
const SELF_SIZED = new Set(['profile']);
// Whose trace this session has been counting. A different person signing in
// in the same tab starts from nothing.
let owner = null;
const lastStart = new Map(); // `${scope}:${record}` -> ms

/** Forget everything this session knows about traces (a new person; tests). */
export function resetTraceSession() {
  knownParts.clear(); scopeBytes.clear(); full.clear(); stored.clear();
}

/**
 * What a scope's stored turns and follow-ups add up to (characters of JSON).
 * Asked for once per scope a session, and only when a trace is being opened,
 * so nothing is read while Trace mode is off.
 */
export function storedTraceBytes(scope) {
  if (!stored.has(scope)) {
    stored.set(scope, Promise.all([listTraceRecords(scope, 't'), listTraceRecords(scope, 'b')])
      .then((lists) => lists.flat().reduce((n, item) => n + JSON.stringify(item.data ?? null).length, 0))
      .catch(() => 0));
  }
  return stored.get(scope);
}

/** What a scope's trace holds so far, as far as this session knows. */
export function traceBytes(scope) { return scopeBytes.get(scope) || 0; }
/** True once a scope reached MAX_SCOPE_BYTES: Trace is on, but nothing more is recorded for it. */
export function traceFull(scope) { return full.has(scope); }

/** Hear each step of a scope's conversation as it is recorded. Returns unsubscribe. */
export function subscribeTrace(scope, fn) {
  if (!listeners.has(scope)) listeners.set(scope, new Set());
  listeners.get(scope).add(fn);
  return () => listeners.get(scope)?.delete(fn);
}

function emit(scope, event) {
  for (const fn of listeners.get(scope) || []) {
    try { fn(event); } catch { /* a panel error must never break a turn */ }
  }
}

/** Whether Trace is on for `scope` for the signed-in person: `{ on, userId }`. */
export async function traceStatus(scope) {
  const [preferences, user] = await Promise.all([getPreferences().catch(() => null), getAuthUser().catch(() => null)]);
  return { on: isTraceOn(preferences, scope), userId: user?.userId || null };
}

/**
 * A recorder for one turn in `scope`, or undefined when Trace is off for it.
 * `record` is 't' (a turn) or 'b' (a follow-up agent). `kind` is 'start' |
 * 'turn' | 'followup' (a lesson), or 'profile' (Settings → Learner Profile).
 */
export async function openTrace(scope, kind, { partial = false, record = 't', used = 0 } = {}) {
  const status = await traceStatus(scope).catch(() => ({ on: false }));
  if (!status.on) return undefined;
  if (status.userId !== owner) { resetTraceSession(); owner = status.userId; }
  // Lessons carry their size on lessonKB.trace.bytes (`used`); the other
  // scopes have no such record, so their stored size is summed once.
  if (SELF_SIZED.has(kind)) used = Math.max(used || 0, await storedTraceBytes(scope));
  // A lesson starting (again, after a reset) has no stored parts and no
  // size: its trace was deleted with it.
  if (kind === 'start' || !knownParts.has(scope)) knownParts.set(scope, new Set());
  if (kind === 'start') { scopeBytes.delete(scope); full.delete(scope); }
  // `used` is what the lesson's own record says was written before this session.
  scopeBytes.set(scope, Math.max(used || 0, traceBytes(scope)));
  if (traceBytes(scope) >= MAX_SCOPE_BYTES) { full.add(scope); return undefined; }
  // A record is keyed by the millisecond it started. Two turns in a scope
  // can start in the same one (a preview straight after a save), so the
  // second is moved on a millisecond rather than overwrite the first.
  const slot = `${scope}:${record}`;
  const startAt = Math.max(Date.now(), (lastStart.get(slot) || 0) + 1);
  lastStart.set(slot, startAt);
  // The reserved time is the record's id, passed as is: reading the clock
  // again here could land a millisecond later, onto the next trace's slot
  // (a lost record, seen under load in CI).
  const trace = createTrace({
    scope, kind, record, partial, at: startAt,
    save: putTraceRecord,
    knownParts: knownParts.get(scope),
    app: {
      build: BUILD,
      language: typeof navigator !== 'undefined' ? navigator.languages?.[0] || navigator.language || null : null,
    },
    onStep: (step) => emit(scope, { kind, step }),
  });
  emit(scope, { kind, started: true });
  const flush = trace.flush;
  trace.flush = async () => {
    const result = await flush();
    if (result?.bytes) scopeBytes.set(scope, traceBytes(scope) + result.bytes);
    if (result) emit(scope, { kind, saved: result });
    return result;
  };
  return trace;
}

/**
 * Run a follow-up agent (profile, unit note) with its own trace record, or
 * with `undefined` when Trace is off for the lesson. A failure is recorded, then thrown
 * on to the queue, which logs it as before.
 */
export async function tracedFollowUp(scope, agent, why, fn) {
  const trace = await openTrace(scope, 'followup', { record: 'b' });
  if (!trace) return fn(undefined);
  trace.step('followUpStart', { agent, why });
  try {
    return await fn(trace);
  } catch (e) {
    trace.fail(e);
    throw e;
  } finally {
    trace.flush();
  }
}
