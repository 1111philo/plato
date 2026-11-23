/**
 * Trace mode (#595) for plugins: what a plugin did while a lesson started, as
 * a list of plain steps a person can read.
 *
 * A traced `lessonStarted` call gets its own recorder (`ctx.trace`), and
 * `ctx.ai` is wrapped so each AI call the plugin makes is recorded without
 * the plugin doing anything. A handler may also return `trace: [step, …]`.
 * Either way the steps pass through `sanitizeSteps` before they leave the
 * server: only known step types and fields, bounded in count and size, with
 * credentials removed.
 *
 * Step shapes (also in packages/plugin-sdk/index.d.ts and
 * docs/plugins/EXTENSION_REFERENCE.md):
 *   { type: 'ai', purpose, model, system, messages, reply, usage?, ms?, error? }
 *   { type: 'fetch', purpose, url, status?, ms?, bytes?, error? }
 *   { type: 'note', text }
 *
 * Nothing here is module-level state: two learners can start lessons at once
 * in one container, so every call builds its own collector and recorders.
 *
 * Nothing here throws to its caller. A bad step is dropped; a bad trace is
 * an empty one. The enrichment is never affected.
 */

import { describeAiError } from '../ai-limits.js';

export const TRACE_LIMITS = Object.freeze({
  /** Steps kept per plugin, per lesson start. */
  steps: 50,
  /** Characters kept in any one text field. */
  text: 20_000,
  /** Characters kept in a short field (purpose, model, error, a role). */
  short: 500,
  /** Characters kept in a URL. */
  url: 2_000,
  /** Messages kept in one AI step. */
  messages: 50,
  /** Size of one plugin's whole trace, as JSON (UTF-8 bytes). */
  bytes: 200_000,
  /**
   * Size of all plugins' traces for one lesson start. The browser stores
   * them inside one trace record, and a sync-data item holds 380 KB. When
   * several plugins together pass this, each gets an equal share.
   */
  totalBytes: 250_000,
});

const REMOVED = '[removed]';
const SECRET_PARAM = /token|secret|passw|signature|credential|api[_-]?key|^(key|sig|code|auth|authorization|session|sessionid|sid|jwt)$|[_-]key$/i;

/**
 * Remove what looks like a credential from text a plugin recorded: an
 * authorization header line, a bearer or basic token, an API-key header, a
 * cookie header. Trace text goes to the learner's browser.
 */
export function scrubSecrets(text) {
  return text
    .replace(/((?:proxy-)?authorization["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, `$1${REMOVED}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REMOVED}`)
    .replace(/(\bx-[a-z0-9-]*(?:key|token|secret|auth)[a-z0-9-]*["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, `$1${REMOVED}`)
    .replace(/((?:^|[\r\n{,])\s*["']?(?:set-)?cookie["']?\s*:\s*["']?)[^\r\n"']*=[^\r\n"']*/gi, `$1${REMOVED}`);
}

function cut(value, max) {
  let s;
  if (typeof value === 'string') s = value;
  else if (value == null) return '';
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else {
    try { s = JSON.stringify(value) ?? ''; } catch { return ''; }
  }
  // Cut before scrubbing: a plugin can hand over megabytes.
  const over = s.length - max;
  if (over > 0) s = s.slice(0, max);
  s = scrubSecrets(s);
  return over > 0 ? `${s}… [${over} more characters left out]` : s;
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/** A message's content as text: text blocks joined, anything else named, not copied. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : content;
  return content.map((block) => {
    if (typeof block === 'string') return block;
    if (block && typeof block.text === 'string') return block.text;
    return `[${typeof block?.type === 'string' ? block.type.slice(0, 40) : 'attachment'}]`;
  }).join('\n');
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages.slice(0, TRACE_LIMITS.messages)) {
    if (!m || typeof m !== 'object') continue;
    out.push({ role: cut(m.role, 40) || 'user', content: cut(contentText(m.content), TRACE_LIMITS.text) });
  }
  return out;
}

function cleanUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(usage).slice(0, 10)) {
    const n = count(v);
    if (n !== undefined && /^[A-Za-z_]{1,40}$/.test(k)) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A URL safe to show: http(s) only, no user:password, and the value of any
 * query parameter named like a credential removed. Null when it isn't a URL.
 */
export function cleanUrl(value) {
  let u;
  try { u = new URL(typeof value === 'string' ? value : String(value?.url ?? value?.href ?? value)); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.username = '';
  u.password = '';
  for (const name of [...new Set(u.searchParams.keys())]) {
    if (SECRET_PARAM.test(name)) u.searchParams.set(name, REMOVED);
  }
  u.hash = '';
  const s = scrubSecrets(u.toString());
  return s.length > TRACE_LIMITS.url ? `${s.slice(0, TRACE_LIMITS.url)}…` : s;
}

function optional(step, fields) {
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') step[k] = v;
  return step;
}

/** One step, cleaned, or null when it isn't a step this host knows. Never throws. */
export function sanitizeStep(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.type === 'ai') {
      return optional({
        type: 'ai',
        purpose: cut(raw.purpose, TRACE_LIMITS.short),
        model: cut(raw.model, TRACE_LIMITS.short),
        system: cut(contentText(raw.system), TRACE_LIMITS.text),
        messages: cleanMessages(raw.messages),
        reply: cut(contentText(raw.reply), TRACE_LIMITS.text),
      }, { usage: cleanUsage(raw.usage), ms: count(raw.ms), error: raw.error == null ? undefined : cut(raw.error, TRACE_LIMITS.short) });
    }
    if (raw.type === 'fetch') {
      const url = cleanUrl(raw.url);
      if (!url) return null;
      return optional({ type: 'fetch', purpose: cut(raw.purpose, TRACE_LIMITS.short), url }, {
        status: count(raw.status),
        ms: count(raw.ms),
        bytes: count(raw.bytes),
        error: raw.error == null ? undefined : cut(raw.error, TRACE_LIMITS.short),
      });
    }
    if (raw.type === 'note') {
      const text = cut(raw.text, TRACE_LIMITS.text);
      return text ? { type: 'note', text } : null;
    }
    return null;
  } catch {
    return null;
  }
}

const LEFT_OUT = Object.freeze({ type: 'note', text: `More steps were left out: a plugin’s trace holds at most ${TRACE_LIMITS.steps} steps and ${TRACE_LIMITS.bytes / 1000} KB.` });
const LEFT_OUT_BYTES = Buffer.byteLength(JSON.stringify(LEFT_OUT)) + 1;

/** Already-cleaned steps, held to the step and size limits, with a closing note when some were left out. */
function bound(steps, maxBytes = TRACE_LIMITS.bytes) {
  const out = [];
  // Room is kept for the closing note, so the result never passes maxBytes.
  let size = 2 + LEFT_OUT_BYTES;
  for (const step of steps) {
    const bytes = Buffer.byteLength(JSON.stringify(step)) + 1;
    if (out.length >= TRACE_LIMITS.steps || size + bytes > maxBytes) {
      out.push(LEFT_OUT);
      break;
    }
    size += bytes;
    out.push(step);
  }
  return out;
}

/**
 * A plugin's whole trace, cleaned and bounded: unknown steps dropped, at most
 * `TRACE_LIMITS.steps` steps and `TRACE_LIMITS.bytes` of JSON, with a closing
 * note when some were left out. Anything that isn't a list is an empty trace.
 * Never throws.
 */
export function sanitizeSteps(raw) {
  try {
    if (!Array.isArray(raw)) return [];
    const clean = [];
    // Look no further than a plainly abusive list needs.
    for (let i = 0; i < raw.length && i < TRACE_LIMITS.steps * 20 && clean.length <= TRACE_LIMITS.steps; i++) {
      const step = sanitizeStep(raw[i]);
      if (step) clean.push(step);
    }
    return bound(clean);
  } catch {
    return [];
  }
}

function replyText(response) {
  return contentText(response?.content);
}

/**
 * The recorder a plugin sees as `ctx.trace` on a traced call. `steps` is the
 * array it appends to (already-cleaned steps); `ai` is the host's AI provider
 * and `fetchImpl` the fetch to use.
 */
export function createRecorder({ steps = [], ai = null, fetchImpl } = {}) {
  const record = (step) => {
    try {
      // Bounded while recording too, so a runaway plugin can't hold memory.
      // One past the limit is kept so the reader is told steps were left out.
      if (steps.length > TRACE_LIMITS.steps) return;
      const clean = sanitizeStep(step);
      if (clean) steps.push(clean);
    } catch { /* a trace never breaks the plugin */ }
  };

  const recorder = {
    /** True on a traced call. The stand-in on an untraced call has `on: false`. */
    on: true,
    record,
    note: (text) => record({ type: 'note', text }),
    /**
     * `fetch`, recorded: the URL (credentials removed), the status, how long
     * it took, and the size when the server states one. Returns the Response
     * untouched; a failure is recorded and rethrown.
     */
    async fetch(purpose, url, init) {
      const started = Date.now();
      const doFetch = fetchImpl || globalThis.fetch;
      try {
        const res = await doFetch(url, init);
        const length = res?.headers?.get?.('content-length');
        record({ type: 'fetch', purpose, url, status: res?.status, ms: Date.now() - started, bytes: length ? Number(length) : undefined });
        return res;
      } catch (err) {
        record({ type: 'fetch', purpose, url, ms: Date.now() - started, error: err?.name === 'AbortError' ? 'Timed out' : String(err?.message || err) });
        throw err;
      }
    },
  };

  // `ctx.ai` for a traced call: the same provider, with each call recorded.
  // A plugin names a call with a third argument, `{ purpose }`, which the
  // provider ignores on an untraced call.
  if (ai) {
    const traced = Object.create(ai);
    traced.invoke = async (model, body, opts) => {
      const started = Date.now();
      const base = { type: 'ai', purpose: opts?.purpose, model, system: body?.system, messages: body?.messages };
      try {
        const response = await ai.invoke(model, body, opts);
        record({ ...base, reply: replyText(response), usage: response?.usage, ms: Date.now() - started });
        return response;
      } catch (err) {
        record({ ...base, reply: '', ms: Date.now() - started, error: aiError(err) });
        throw err;
      }
    };
    traced.invokeStream = async function* (model, body, opts) {
      const started = Date.now();
      const base = { type: 'ai', purpose: opts?.purpose, model, system: body?.system, messages: body?.messages };
      let reply = '';
      let usage;
      let failed;
      try {
        for await (const event of ai.invokeStream(model, body, opts)) {
          if (event?.type === 'content_block_delta' && typeof event.delta?.text === 'string' && event.delta.type !== 'reasoning_delta') {
            if (reply.length < TRACE_LIMITS.text * 2) reply += event.delta.text;
          }
          if (event?.usage) usage = event.usage;
          yield event;
        }
      } catch (err) {
        failed = err;
        throw err;
      } finally {
        // Also runs when the plugin stops reading early.
        record({ ...base, reply, usage, ms: Date.now() - started, ...(failed ? { error: aiError(failed) } : {}) });
      }
    };
    recorder.ai = traced;
  }
  return recorder;
}

/** The provider's error without AWS identifiers (as `/v1/ai/messages` reports it). */
function aiError(err) {
  const d = describeAiError(err);
  return `${d.name}: ${d.message}`;
}

/**
 * `ctx.trace` on an untraced call: records nothing, and `fetch` is plain
 * `fetch`, so a plugin can call the same code either way.
 */
export const NO_TRACE = Object.freeze({
  on: false,
  record() {},
  note() {},
  fetch: (purpose, url, init) => globalThis.fetch(url, init),
});

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * One lesson start's plugin traces. The route makes one per traced request
 * and hands it to the hook bus; the registry asks it for a recorder per
 * plugin, passing the AI provider to wrap. `result()` can be read at any time
 * (a plugin still running after the route's timeout simply isn't finished in
 * it).
 */
export function createTraceCollector() {
  const byPlugin = new Map();
  const stepsFor = (id) => {
    if (!byPlugin.has(id)) byPlugin.set(id, []);
    return byPlugin.get(id);
  };
  return {
    /** A recorder for this plugin's part in this call. */
    recorderFor(pluginId, { ai = null, fetchImpl } = {}) {
      return createRecorder({ steps: stepsFor(pluginId), ai, fetchImpl });
    },
    /** Steps a handler returned as `trace`, added after what it recorded. */
    addReturned(pluginId, raw) {
      try {
        const steps = stepsFor(pluginId);
        for (const step of sanitizeSteps(raw)) if (steps.length <= TRACE_LIMITS.steps) steps.push(step);
      } catch { /* dropped */ }
    },
    /** `{ [pluginId]: steps }`, cleaned and bounded; plugins with no steps are left out. */
    result() {
      const out = {};
      const traced = [...byPlugin].filter(([id, steps]) => PLUGIN_ID.test(id) && steps.length);
      const share = Math.min(TRACE_LIMITS.bytes, Math.floor(TRACE_LIMITS.totalBytes / Math.max(1, traced.length)));
      for (const [id, steps] of traced) out[id] = bound(steps, share);
      return out;
    },
  };
}
