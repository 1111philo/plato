/**
 * Trace mode's recorder (#595, docs/ARCHITECTURE.md "Trace mode").
 *
 * A trace is the ordered list of steps behind one turn of a conversation:
 * what the person sent, what plato assembled, every AI call (the exact
 * request and raw reply), what plato's code read from the reply and changed,
 * and what was saved. lib/transparency.js says in plain words what each step
 * type means and who decided it (the model, plato's instructions, plato's
 * code, or a person).
 *
 * Off is a strict no-op: callers hold `undefined` instead of a recorder and
 * reach it only through `trace?.…`, so nothing is built, sent or stored.
 *
 * Pure except for the injected `save`. Unit tests: client/tests/lessonTrace.test.js.
 */

export const TRACE_VERSION = 1;

// One prompt part or record stays under the server's 380 KB item cap.
export const MAX_PART_CHARS = 300_000;
// A whole conversation's trace. Past it, recording stops and says so.
export const MAX_SCOPE_BYTES = 1.5 * 1024 * 1024;
// An attached page can be 50,000 characters and is fetched again by anyone
// who needs it; the trace keeps the start and the length.
export const LINK_EXCERPT_CHARS = 2000;
// Parts shorter than this are kept inside the turn's record.
const INLINE_PART_CHARS = 600;
const LINK_MARKER = '[REFERENCE CONTEXT';

/** Whether Trace mode is on for this person: their own switch, or an admin's. */
export function isTraceOn({ preferences, user } = {}) {
  return !!(preferences?.traceMode || user?.traceMode);
}

/** Who turned it on: `'team'` (an admin, for this person) or `'self'`. */
export function traceTurnedOnBy({ user } = {}) {
  return user?.traceMode ? 'team' : 'self';
}

/** `trace:<scope>:<kind>:<id>`: kind t = a turn, b = a follow-up agent, p = a prompt part. */
export function traceKey(scope, kind, id) {
  return `trace:${scope}:${kind}:${id}`;
}

/**
 * A 16-hex-character fingerprint of some text (two FNV-1a passes). It names a
 * stored prompt part and shows whether two turns used the same instructions.
 * Not a security hash.
 */
export function hashText(text) {
  const s = String(text ?? '');
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * A request's messages as the trace keeps them: exact, except an image
 * becomes its type and size (the picture itself is in its `screenshot:`
 * record), and an attached page keeps its first LINK_EXCERPT_CHARS and its
 * length. `storableBody` applies the same rule to a whole request, so a trace
 * can be compared with what was really sent (the replay test).
 */
export function storableMessages(messages) {
  return (messages || []).map((m) => ({ role: m.role, content: storableContent(m.content) }));
}

function storableContent(content) {
  if (typeof content === 'string') return storableText(content);
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (block?.type === 'image') return { type: 'image', mediaType: block.source?.media_type || null, base64Chars: block.source?.data?.length || 0 };
    if (block?.type === 'text') { const t = storableText(block.text); return typeof t === 'string' ? { type: 'text', text: t } : { type: 'text', ...t }; }
    return block;
  });
}

function storableText(text) {
  if (typeof text !== 'string' || !text.startsWith(LINK_MARKER) || text.length <= LINK_EXCERPT_CHARS) return text;
  return { excerpt: text.slice(0, LINK_EXCERPT_CHARS), chars: text.length };
}

/** A request body with its messages in stored form (see storableMessages). */
export function storableBody(body) {
  return { ...body, messages: storableMessages(body.messages) };
}

function errorInfo(err) {
  if (!err) return null;
  return {
    type: err.type || err.name || 'Error',
    message: String(err.message || err).slice(0, 500),
    ...(err.status != null ? { status: err.status } : {}),
    ...(err.retryAfterMs ? { retryAfterMs: err.retryAfterMs } : {}),
    ...(err.plato ? { server: err.plato } : {}),
  };
}

/**
 * Start recording one turn (or a lesson start, a follow-up agent, an
 * authoring turn).
 *
 * @param {object} o
 * @param {string} o.scope    a lesson id, 'profile', 'kb', or 'author-<lessonId>'
 * @param {string} o.kind     'start' | 'turn' | 'followup' | 'profile' | 'authoring'
 * @param {function} o.save   async (key, data) => ({ ok }) — storage.putTraceRecord
 * @param {object} [o.app]    what was running: `{ build, language, by }`
 * @param {boolean} [o.partial] recording began after the lesson did
 * @param {Set} [o.knownParts] hashes already stored for this scope (shared across turns)
 * @param {function} [o.onStep] called with each step as it is recorded (the live panel)
 * @param {function} [o.now]
 */
export function createTrace({ scope, kind, save, app = {}, partial = false, knownParts = new Set(), onStep, now = Date.now, record = 't' }) {
  const startedAt = now();
  const steps = [];
  const pendingParts = new Map(); // hash -> text
  let base = null; // the turn's messages, stored once and shared by its calls
  let failure = null;
  let flushed = false;

  const step = (type, data = {}) => {
    const s = { n: steps.length + 1, type, ms: now() - startedAt, ...data };
    steps.push(s);
    try { onStep?.(s); } catch { /* a listener must never break a turn */ }
    return s;
  };

  // A prompt part: short ones inline, long ones by fingerprint in their own record.
  const partRef = ({ kind: partKind, text }) => {
    const t = String(text ?? '');
    if (t.length <= INLINE_PART_CHARS) return { kind: partKind, chars: t.length, text: t };
    const hash = hashText(t);
    if (!knownParts.has(hash)) pendingParts.set(hash, t.slice(0, MAX_PART_CHARS));
    return { kind: partKind, chars: t.length, hash, ...(t.length > MAX_PART_CHARS ? { cut: true } : {}) };
  };

  const messagesRef = (messages) => {
    if (base && messages.length >= base.length && base.every((m, i) => m === messages[i])) {
      return { base: base.length, extra: storableMessages(messages.slice(base.length)) };
    }
    return { base: 0, extra: storableMessages(messages) };
  };

  return {
    scope,
    kind,
    app,
    steps,
    step,

    /** The messages every coach call this turn starts from; stored once. */
    setBase(messages) {
      base = messages;
      step('history', { messages: storableMessages(messages) });
    },

    /**
     * One AI call. Returns a handle: `attempt(err)` for each failed try that
     * was retried, `meta(m)` for stream metadata, `end(reply)` or `fail(err)`.
     */
    begin({ agent, purpose, model, maxTokens, temperature, stream = false, parts = [], messages = [] }) {
      const callStart = now();
      const call = step('call', {
        agent, purpose: purpose || null, model, maxTokens,
        temperature: temperature ?? null, stream,
        system: parts.map(partRef),
        messages: messagesRef(messages),
        attempts: [],
      });
      const meta = (m = {}) => {
        if (m.usage) call.usage = m.usage;
        if (m.stopReason) call.stopReason = m.stopReason;
        if (m.plato) call.server = { ...(call.server || {}), ...m.plato };
        if (typeof m.reasoning === 'string') call.reasoning = ((call.reasoning || '') + m.reasoning).slice(0, MAX_PART_CHARS);
      };
      return {
        attempt(err) { call.attempts.push(errorInfo(err)); },
        meta,
        end(reply, m) { meta(m); call.reply = reply; call.took = now() - callStart; },
        fail(err) { call.error = errorInfo(err); call.took = now() - callStart; },
      };
    },

    /** The turn failed: recorded, then the caller rethrows. */
    fail(err) {
      failure = errorInfo(err);
      step('error', { error: failure });
    },

    /**
     * Write the trace: new prompt parts first, then the turn's record. Never
     * throws, and never runs twice. Returns `{ key, ok }`.
     */
    async flush() {
      if (flushed) return null;
      flushed = true;
      const id = String(startedAt).padStart(13, '0');
      const key = traceKey(scope, record, id);
      try {
        for (const [hash, text] of pendingParts) {
          const res = await save(traceKey(scope, 'p', hash), { v: TRACE_VERSION, hash, text });
          if (res?.ok) knownParts.add(hash);
        }
        const data = {
          v: TRACE_VERSION, kind, at: startedAt, took: now() - startedAt,
          app, ...(partial ? { partial: true } : {}), ...(failure ? { failed: true } : {}),
          steps,
        };
        const res = await save(key, data);
        return { key, ok: !!res?.ok };
      } catch {
        return { key, ok: false };
      }
    },
  };
}

/**
 * Which of plato's code rules changed the outcome of a turn, worked out by
 * comparing what the model reported with what was kept (applyCoachResponseToKB
 * and the grading check own the rules; this only reads their effect).
 * lib/transparency.js has the wording for each rule id.
 */
export function rulesApplied({ before = {}, after = {}, modelProgress = null, replyProgress = null, parsed = {}, assessment = null, achieved = false, newlyMet = [] }) {
  const rules = [];
  const wasCompleted = before.status === 'completed';
  const asked = parsed?.progress ?? null;
  const total = after.objectives?.length || 0;
  const met = after.objectivesMet?.length || 0;
  if (modelProgress == null) rules.push('noProgressTag');
  if (asked != null && (!Number.isInteger(asked) || asked < 0 || asked > 10)) rules.push('clamped');
  if (assessment?.held) rules.push('heldAt8');
  if (assessment?.failed && !assessment.failedOpen) rules.push('checkFailedNothingCounted');
  if (assessment?.failedOpen) rules.push('checkFailedTwiceGradingStood');
  if (assessment?.unverified) rules.push('objectivesNotBackedUp');
  if (assessment?.replaced) rules.push('replyReplaced');
  if (wasCompleted) rules.push('frozenAfterCompletion');
  else if (asked != null && asked >= 10 && !achieved && total > 0 && met < total) rules.push('cappedAt9');
  if ((before.insights?.length || 0) + (parsed?.kbUpdate?.insights?.length || 0) > 10) rules.push('notesFolded');
  if (achieved) rules.push('completed');
  return {
    rules,
    modelProgress, replyProgress, gradedProgress: asked,
    progress: { before: before.progress ?? 0, after: after.progress ?? 0 },
    status: { before: before.status || 'active', after: after.status || 'active' },
    exchanges: { before: before.activitiesCompleted || 0, after: after.activitiesCompleted || 0 },
    objectivesMet: { before: before.objectivesMet || [], after: after.objectivesMet || [], total },
    newlyMet,
    learnerPosition: { before: before.learnerPosition || '', after: after.learnerPosition || '' },
    notesAdded: parsed?.kbUpdate?.insights || [],
  };
}

/**
 * The request a recorded call sent, rebuilt from the trace alone:
 * `{ model, max_tokens, system, messages, stream?, temperature?, trace }` in
 * stored form. `parts` maps a fingerprint to its text (the `p` records);
 * `history` is the turn's `history` step. Used by the replay test, and by the
 * Trace view to show exactly what the model was given.
 */
export function rebuildRequest(call, { history, parts = {} } = {}) {
  const system = call.system.map((p) => (p.hash ? parts[p.hash] ?? null : p.text));
  const baseMessages = (history?.messages || []).slice(0, call.messages.base);
  return {
    model: call.model,
    max_tokens: call.maxTokens,
    system: system.includes(null) ? null : system.join(''),
    messages: [...baseMessages, ...call.messages.extra],
    ...(call.stream ? { stream: true } : {}),
    ...(call.temperature != null ? { temperature: call.temperature } : {}),
    trace: true,
  };
}
