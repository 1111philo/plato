/**
 * Opens a Trace recorder for the signed-in person when Trace mode is on
 * (#595). The impure half of lib/lessonTrace.js: it reads the two switches
 * (the person's own preference and the admin-set flag), writes records
 * through storage, and lets the Trace panel listen to a conversation as it
 * happens.
 *
 * `openTrace` resolves to `undefined` when Trace mode is off, which is what
 * every caller passes on as `trace`; nothing else in the app checks the
 * switches.
 */
import { getPreferences, getAuthUser, putTraceRecord } from '../../js/storage.js';
import { createTrace, isTraceOn, traceTurnedOnBy, MAX_SCOPE_BYTES } from './lessonTrace.js';

/* global __PLATO_BUILD__ */
const BUILD = typeof __PLATO_BUILD__ === 'string' ? __PLATO_BUILD__ : 'dev';

// Prompt parts already stored, per scope, so each is written once a session.
const knownParts = new Map();
const listeners = new Map(); // scope -> Set<fn>
// How much each scope's trace holds (characters written), and which are full.
const scopeBytes = new Map();
const full = new Set();

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

/** Who has Trace mode on for the signed-in person: `{ on, by }`. */
export async function traceStatus() {
  const [preferences, user] = await Promise.all([getPreferences().catch(() => null), getAuthUser().catch(() => null)]);
  return { on: isTraceOn({ preferences, user }), by: traceTurnedOnBy({ user }) };
}

/**
 * A recorder for one turn in `scope`, or undefined when Trace mode is off.
 * `record` is 't' (a turn) or 'b' (a follow-up agent).
 */
export async function openTrace(scope, kind, { partial = false, record = 't', used = 0 } = {}) {
  const status = await traceStatus().catch(() => ({ on: false }));
  if (!status.on) return undefined;
  // A lesson starting (again, after a reset) has no stored parts and no
  // size: its trace was deleted with it.
  if (kind === 'start' || !knownParts.has(scope)) knownParts.set(scope, new Set());
  if (kind === 'start') { scopeBytes.delete(scope); full.delete(scope); }
  // `used` is what the lesson's own record says was written before this session.
  scopeBytes.set(scope, Math.max(used || 0, traceBytes(scope)));
  if (traceBytes(scope) >= MAX_SCOPE_BYTES) { full.add(scope); return undefined; }
  const trace = createTrace({
    scope, kind, record, partial,
    save: putTraceRecord,
    knownParts: knownParts.get(scope),
    app: {
      build: BUILD,
      by: status.by,
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
 * with `undefined` when Trace mode is off. A failure is recorded, then thrown
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
