/**
 * The scope part of a Trace record's key, `trace:<scope>:<t|b|p>:<id>` (#595).
 *
 * The server accepts only letters, digits, `-` and `_` there, up to 120
 * characters (server/src/routes/sync.js VALID_DATA_KEYS), and `:` separates
 * the key's parts. A lesson's id can hold anything its author typed (seen on
 * playground: `&`, `:`, spaces), and a trace of such a lesson was refused on
 * every write, without a word. An id that is already safe is used as it is,
 * so traces recorded before this keep their keys; any other id becomes its
 * safe characters plus a fingerprint of the whole id, the same every time.
 *
 * Pure. Unit tests: client/tests/traceScope.test.js.
 */
const SAFE = /^[A-Za-z0-9_-]{1,120}$/;

// Two 32-bit FNV-1a hashes with different seeds: 16 hex characters.
function fingerprint(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The key-safe form of a Trace scope (a lesson id, or `profile`). */
export function traceScopeKey(scope) {
  const text = String(scope ?? '');
  if (SAFE.test(text)) return text;
  const readable = text.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return `${readable || 'scope'}_${fingerprint(text)}`;
}
