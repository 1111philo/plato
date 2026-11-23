/**
 * A fake plato server for client tests that run real lessons through the
 * engine: sync-data in memory, the real prompt files, and the server's own
 * mock AI provider (server/src/lib/ai-mock.js), answering as routes/ai.js
 * does. Every AI request body is kept in `ai`, so a test can check exactly
 * what was sent.
 *
 * Import this before any app module: it installs fetch and localStorage.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mockAi from '../../../server/src/lib/ai-mock.js';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '../../prompts');

export const store = new Map();
const versions = new Map();
export const ai = []; // every /v1/ai/messages request body, in order
export const events = []; // every /v1/ai/events code
export let user = { userId: 'usr_test', firstName: 'Ada', name: 'Ada Lovelace' };

export const LESSON = {
  lessonId: 'trace-lesson', name: 'Trace lesson', description: 'A short lesson.',
  exemplar: 'A short written example.',
  learningObjectives: ['Can name the key idea', 'Can apply it to an example'],
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const PROVIDER = { provider: 'mock', model: 'mock', region: null, api: 'mock' };

async function aiMessages(body) {
  ai.push(body);
  const tracing = body.trace === true;
  const applied = { max_tokens: body.max_tokens, maxTokensDefaulted: false, temperature: body.temperature ?? null, dropped: [] };
  const facts = { provider: PROVIDER, applied };
  if (!body.stream) {
    const result = await mockAi.invoke(body.model, body);
    return json(tracing ? { ...result, plato: { ...facts, ms: 1, attempts: 1 } } : result);
  }
  const iterator = mockAi.invokeStream(body.model, body)[Symbol.asyncIterator]();
  let first;
  try { first = await iterator.next(); } catch {
    return json({ error: 'The AI service is busy. Please try again in a moment.', code: 'throttled', retryAfterMs: 1, ...(tracing ? { plato: { ...facts, ms: 1, error: { name: 'ThrottlingException', status: null, attempts: null, message: 'Too many requests' } } } : {}) }, 429);
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (v) => controller.enqueue(enc.encode(`data: ${typeof v === 'string' ? v : JSON.stringify(v)}\n\n`));
      if (tracing) send({ type: 'plato', ...facts, firstEventMs: 1 });
      for (let next = first; !next.done; next = await iterator.next()) send(next.value);
      if (tracing) send({ type: 'plato', ms: 2 });
      send('[DONE]');
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url, 'http://localhost');
  const path = u.pathname;
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;

  if (path === '/v1/ai/messages') return aiMessages(body);
  if (path === '/v1/ai/events') { events.push(body.code); return json({ ok: true }); }
  if (path.startsWith('/v1/prompts/')) return json({ content: readFileSync(join(PROMPTS, `${decodeURIComponent(path.slice(12))}.md`), 'utf8'), updatedAt: '2026-11-01T00:00:00Z' });
  if (path === '/v1/knowledge-base') return json({ content: '# Program\n\nA program for tests. '.padEnd(900, 'About the program. ') });
  if (path === '/v1/lessons') return json([]);
  if (path === '/v1/sync/lesson-started') return json({ enrichments: [] });
  if (path === '/v1/sync' && method === 'GET') {
    const prefix = u.searchParams.get('prefix');
    const keys = [...store.keys()].filter((k) => (prefix ? k.startsWith(prefix) : !k.startsWith('trace:') && !k.startsWith('screenshot:')));
    return json(keys.map((k) => ({ dataKey: k, data: store.get(k), version: versions.get(k) || 0 })));
  }
  const m = path.match(/^\/v1\/sync\/(.+)/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    if (method === 'PUT') {
      const current = versions.get(key) || 0;
      if (body.version && body.version !== current) return json({}, 409);
      store.set(key, body.data);
      versions.set(key, current + 1);
      return json({ version: current + 1 });
    }
    if (method === 'DELETE') { store.delete(key); versions.delete(key); return json({ ok: true }); }
    return json({ dataKey: key, data: store.has(key) ? store.get(key) : null, version: versions.get(key) || 0 });
  }
  return json({ error: 'not found' }, 404);
};

function webStorage() {
  return { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; }, clear() { this._s = {}; } };
}
globalThis.localStorage = webStorage();
globalThis.sessionStorage = webStorage();

/** Sign in as a learner; `traceMode` is the admin-set flag on the account. */
export function signIn({ traceMode = false } = {}) {
  user = { userId: 'usr_test', firstName: 'Ada', name: 'Ada Lovelace', ...(traceMode ? { traceMode: true } : {}) };
  localStorage.setItem('plato_auth', JSON.stringify({ accessToken: 't', refreshToken: 'r', user }));
}

export function reset() {
  store.clear(); versions.clear(); ai.length = 0; events.length = 0;
  signIn();
}

/** The scope's trace records by kind: `{ t: [...], b: [...], p: { hash: text } }`. */
export function traces(scope) {
  const out = { t: [], b: [], p: {} };
  for (const key of [...store.keys()].filter((k) => k.startsWith(`trace:${scope}:`)).sort()) {
    const kind = key.split(':')[2];
    if (kind === 'p') out.p[store.get(key).hash] = store.get(key).text;
    else out[kind].push(store.get(key));
  }
  return out;
}

/**
 * Wait for background agents and trace writes to finish: the follow-up queues
 * are empty, then nothing new for 150 ms.
 */
export async function settle() {
  const { queueProfileUpdate } = await import('../../src/lib/profileQueue.js');
  const { queueCourseProgressUpdate } = await import('../../src/lib/courseProgressQueue.js');
  await queueProfileUpdate(() => {});
  await queueCourseProgressUpdate(() => {});
  let quiet = 0;
  let seen = '';
  for (let i = 0; i < 300 && quiet < 15; i++) {
    await new Promise((r) => setTimeout(r, 10));
    const now = `${ai.length}:${store.size}`;
    quiet = now === seen ? quiet + 1 : 0;
    seen = now;
  }
}

signIn();
