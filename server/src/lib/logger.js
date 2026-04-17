// Ring-buffer logger. Primary consumer is the plato-pilot agent via /v1/admin/logs.
// Logs are keyed by a stable snake_case `code` (not free-form messages) so the
// agent can group and count errors. Each call also writes structured JSON to
// stdout, which Lambda forwards to CloudWatch — that's the second source the
// endpoint merges in.

const DEFAULT_SIZE = 500;
const MAX_META_BYTES = 2048;
const MAX_STACK_FRAMES = 10;

function bufferSize() {
  const n = parseInt(process.env.LOG_BUFFER_SIZE, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SIZE;
}

const buffer = [];
let cursor = 0;

function coerceCode(raw) {
  if (typeof raw !== 'string' || !raw.length) return 'unknown';
  const clean = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || 'unknown';
}

function truncateStack(stack) {
  if (typeof stack !== 'string') return stack;
  return stack.split('\n').slice(0, MAX_STACK_FRAMES).join('\n');
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = { ...meta };
  if (typeof out.stack === 'string') out.stack = truncateStack(out.stack);
  try {
    const serialized = JSON.stringify(out);
    if (serialized.length <= MAX_META_BYTES) return out;
    return { _truncated: true, preview: serialized.slice(0, MAX_META_BYTES) };
  } catch {
    return { _unserializable: true };
  }
}

function nextLogId() {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function push(level, rawCode, rawMeta) {
  const originalCode = typeof rawCode === 'string' ? rawCode : '';
  const code = coerceCode(originalCode);
  const meta = sanitizeMeta(rawMeta);
  const entry = { logId: nextLogId(), ts: new Date().toISOString(), level, code, meta };

  const size = bufferSize();
  if (buffer.length < size) {
    buffer.push(entry);
  } else {
    buffer[cursor] = entry;
    cursor = (cursor + 1) % size;
  }

  // Mirror to stdout as structured JSON so Lambda → CloudWatch captures the
  // same shape. logId is included so the endpoint can dedupe when the same
  // event is retrieved from both the buffer and CloudWatch.
  const payload = JSON.stringify({ logId: entry.logId, level, code, ...meta });
  if (level === 'error') console.error(payload);
  else console.warn(payload);

  // Surface code coercion as a separate warn event so misuse is visible.
  if (originalCode && originalCode !== code) {
    push('warn', 'logger_bad_code', { attempted: originalCode, coerced: code });
  }
}

export const logger = {
  error(code, meta) { push('error', code, meta); },
  warn(code, meta) { push('warn', code, meta); },

  recent({ since, level, limit = 200 } = {}) {
    const sinceMs = since ? new Date(since).getTime() : 0;
    const result = [];
    for (const e of buffer) {
      if (!e) continue;
      if (level && e.level !== level) continue;
      if (sinceMs && new Date(e.ts).getTime() < sinceMs) continue;
      result.push(e);
    }
    result.sort((a, b) => b.ts.localeCompare(a.ts));
    return result.slice(0, limit);
  },

  groups({ since, level } = {}) {
    const entries = this.recent({ since, level, limit: bufferSize() });
    const byCode = new Map();
    for (const e of entries) {
      const g = byCode.get(e.code);
      if (!g) {
        byCode.set(e.code, { code: e.code, level: e.level, count: 1, firstSeen: e.ts, lastSeen: e.ts, sources: ['buffer'], sample: e });
      } else {
        g.count++;
        if (e.ts < g.firstSeen) g.firstSeen = e.ts;
        if (e.ts > g.lastSeen) { g.lastSeen = e.ts; g.sample = e; }
      }
    }
    return [...byCode.values()].sort((a, b) => b.count - a.count);
  },

  // Test-only: reset state between test cases.
  _reset() {
    buffer.length = 0;
    cursor = 0;
  },

  _bufferSize: bufferSize,
};

export default logger;
