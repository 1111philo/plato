/**
 * Trace mode for plugins (#595), through the real route, hook bus and
 * registry: `POST /v1/sync/lesson-started`.
 *
 * - Without `trace: true` the hook payload, the plugin's context and the
 *   response are what they were before Trace mode.
 * - With it, each plugin's steps come back in `pluginTraces`, apart from
 *   `enrichments` (which the browser stores on the lessonKB for the coach).
 * - An older plugin, a plugin that returns a bad or huge trace, and a plugin
 *   that throws never break lesson start.
 * - The WordPress Info plugin itself reports its two AI calls and each search.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import sync from '../../src/routes/sync.js';
import { on, _reset as resetHooks } from '../../src/lib/plugins/hooks.js';
import { pluginRegistry } from '../../src/lib/plugins/registry.js';
import { TRACE_LIMITS } from '../../src/lib/plugins/trace.js';
import ai from '../../src/lib/ai-provider.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import wordpressInfo from '../../../plugins/wordpress-info/server/index.js';

const userId = 'test-user-lesson-trace';
const LESSON = { name: 'Blocks', markdown: '# Blocks', exemplar: 'A registered block', learningObjectives: ['Can register a block'] };

const real = { getUserById: db.getUserById, getSyncData: db.getSyncData, putSyncData: db.putSyncData, invoke: ai.invoke, fetch: globalThis.fetch, log: console.log, warn: console.warn, error: console.error };

let app;
let token;

/** Enable these plugins (`{ id: serverModule }`) through the registry, as an admin would. */
async function enable(plugins) {
  const entries = {};
  for (const [id, serverModule] of Object.entries(plugins)) {
    entries[id] = {
      manifest: { id, name: id, version: '1.0.0', capabilities: ['hook.lessonStarted', 'lessonEnrichment'], extensionPoints: { hooks: ['lessonStarted'] } },
      dir: `/fake/${id}`, serverModule, enabled: false, settings: {}, hasStoredState: false, loadError: null, hookUnsubs: [],
    };
  }
  pluginRegistry._load(entries);
  for (const id of Object.keys(plugins)) await pluginRegistry.setEnabled(id, true);
}

async function start(body) {
  const res = await app.fetch(new Request('http://localhost/v1/sync/lesson-started', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lessonId: 'blocks', lesson: LESSON, lessonKB: { objectives: [] }, ...body }),
  }));
  return { status: res.status, data: await res.json() };
}

beforeEach(async () => {
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  resetHooks();
  pluginRegistry._reset();
  let stored = { version: 0, data: {} };
  db.getUserById = async (id) => (id === userId ? { userId, email: 't@example.com', username: 't', name: 'T', role: 'user' } : null);
  db.getSyncData = async (u, k) => (u === '_system' && k === 'plugins:activation' ? structuredClone(stored) : null);
  db.putSyncData = async (_u, _k, data, version) => { stored = { version: (version || 0) + 1, data: structuredClone(data) }; };
  token = await signAccessToken(userId, 'user');
  app = new Hono();
  app.route('/', sync);
});

afterEach(() => {
  resetHooks();
  pluginRegistry._reset();
  db.getUserById = real.getUserById; db.getSyncData = real.getSyncData; db.putSyncData = real.putSyncData;
  ai.invoke = real.invoke;
  globalThis.fetch = real.fetch;
  console.log = real.log; console.warn = real.warn; console.error = real.error;
});

const ENRICHMENT = { pluginId: 'docs', label: 'Docs', context: 'Some context', reasoning: 'Why', sources: [{ url: 'https://example.com/a', title: 'A' }] };

describe('lesson-started without `trace: true` is what it always was', () => {
  it('the payload, the plugin’s context and the response carry nothing new', async () => {
    const seen = [];
    await enable({ docs: { hooks: { lessonStarted: (payload, ctx) => { seen.push({ payload, ctx, args: 2 }); return { ...ENRICHMENT }; } } } });
    const { status, data } = await start({});
    assert.equal(status, 200);
    assert.deepEqual(data, { enrichments: [ENRICHMENT], startupSteps: [] });
    assert.deepEqual(Object.keys(seen[0].payload), ['userId', 'lessonId', 'lesson', 'lessonKB']);
    assert.equal(seen[0].ctx.ai, ai, 'the provider itself, not a recording wrapper');
    assert.equal(seen[0].ctx.trace.on, false);
  });

  it('only the literal `true` turns it on', async () => {
    const seen = [];
    await enable({ docs: { hooks: { lessonStarted: (payload, ctx) => { seen.push({ payload, on: ctx.trace.on }); ctx.trace.note('ignored'); return { ...ENRICHMENT }; } } } });
    for (const trace of ['true', 1, {}, false, null]) {
      const { data } = await start({ trace });
      assert.deepEqual(Object.keys(data), ['enrichments', 'startupSteps'], `trace: ${JSON.stringify(trace)}`);
    }
    assert.ok(seen.every((s) => !('trace' in s.payload) && s.on === false));
  });

  it('a plugin that returns `trace` unasked still can’t put it in an enrichment', async () => {
    await enable({ docs: { hooks: { lessonStarted: () => ({ ...ENRICHMENT, trace: [{ type: 'note', text: 'unasked' }] }) } } });
    const { data } = await start({});
    assert.deepEqual(data, { enrichments: [ENRICHMENT], startupSteps: [] });
  });
});

describe('lesson-started with `trace: true`', () => {
  it('tells the plugin, records through ctx.trace and ctx.ai, and returns the steps apart from the enrichment', async () => {
    const seen = [];
    ai.invoke = async () => ({ content: [{ type: 'text', text: 'A reply' }], usage: { input_tokens: 4, output_tokens: 2 } });
    globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-length': '2' } });
    await enable({ docs: { hooks: { lessonStarted: async (payload, ctx) => {
      seen.push(payload);
      await ctx.ai.invoke(ctx.LLM, { system: 'Be brief.', messages: [{ role: 'user', content: 'Summarise' }] }, { purpose: 'Summarise the docs' });
      await ctx.trace.fetch('Look up the docs', 'https://example.com/search?q=blocks&api_key=SECRET', { headers: { Authorization: 'Bearer SECRETSECRET' } });
      ctx.trace.note('Kept one result.');
      return { ...ENRICHMENT };
    } } } });

    const { status, data } = await start({ trace: true });
    assert.equal(status, 200);
    assert.equal(seen[0].trace, true);
    assert.deepEqual(Object.keys(data), ['enrichments', 'startupSteps', 'pluginTraces']);
    assert.deepEqual(data.enrichments, [ENRICHMENT], 'the enrichment is the same as untraced');
    const steps = data.pluginTraces.docs;
    assert.deepEqual(steps.map((s) => s.type), ['ai', 'fetch', 'note']);
    assert.equal(steps[0].purpose, 'Summarise the docs');
    assert.equal(steps[0].system, 'Be brief.');
    assert.deepEqual(steps[0].messages, [{ role: 'user', content: 'Summarise' }]);
    assert.equal(steps[0].reply, 'A reply');
    assert.equal(steps[1].status, 200);
    assert.doesNotMatch(JSON.stringify(data), /SECRET/);
  });

  it('an older plugin that knows nothing about tracing still works', async () => {
    await enable({ docs: { hooks: { lessonStarted: ({ lessonId }) => ({ ...ENRICHMENT, context: `for ${lessonId}` }) } } });
    const { status, data } = await start({ trace: true });
    assert.equal(status, 200);
    assert.deepEqual(data, { enrichments: [{ ...ENRICHMENT, context: 'for blocks' }], startupSteps: [], pluginTraces: {} });
  });

  it('a handler can return its steps as `trace`; they are moved out of the enrichment', async () => {
    await enable({ docs: { hooks: { lessonStarted: (_p, ctx) => { ctx.trace.note('recorded'); return { ...ENRICHMENT, trace: [{ type: 'note', text: 'returned' }, { type: 'fetch', purpose: 'p', url: 'https://example.com/x', status: 404 }] }; } } } });
    const { data } = await start({ trace: true });
    assert.deepEqual(data.enrichments, [ENRICHMENT]);
    assert.deepEqual(data.pluginTraces.docs, [
      { type: 'note', text: 'recorded' },
      { type: 'note', text: 'returned' },
      { type: 'fetch', purpose: 'p', url: 'https://example.com/x', status: 404 },
    ]);
  });

  it('a plugin that adds nothing still shows what it did', async () => {
    await enable({ docs: { hooks: { lessonStarted: (_p, ctx) => { ctx.trace.note('Not relevant to this lesson.'); return null; } } }, other: { hooks: { lessonStarted: () => ({ trace: [{ type: 'note', text: 'Only a trace.' }] }) } } });
    const { data } = await start({ trace: true });
    assert.deepEqual(data.enrichments, []);
    assert.deepEqual(data.pluginTraces, { docs: [{ type: 'note', text: 'Not relevant to this lesson.' }], other: [{ type: 'note', text: 'Only a trace.' }] });
  });

  it('a malformed trace is dropped and the enrichment still returned', async () => {
    const circular = {}; circular.self = circular;
    const bad = ['steps', 42, { type: 'note', text: 'not a list' }, [null, 7, 'x', { type: 'exec' }, [[]]], true];
    for (const trace of bad) {
      resetHooks(); pluginRegistry._reset();
      await enable({ docs: { hooks: { lessonStarted: () => ({ ...ENRICHMENT, trace }) } } });
      const { status, data } = await start({ trace: true });
      assert.equal(status, 200);
      assert.deepEqual(data, { enrichments: [ENRICHMENT], startupSteps: [], pluginTraces: {} }, JSON.stringify(trace));
    }
    resetHooks(); pluginRegistry._reset();
    await enable({ docs: { hooks: { lessonStarted: () => ({ ...ENRICHMENT, trace: [{ type: 'note', text: circular }, { type: 'ai', get system() { throw new Error('boom'); } }, { type: 'note', text: 'fine' }] }) } } });
    const { status, data } = await start({ trace: true });
    assert.equal(status, 200);
    assert.deepEqual(data.enrichments, [ENRICHMENT]);
    assert.deepEqual(data.pluginTraces, { docs: [{ type: 'note', text: 'fine' }] });
  });

  it('an oversized trace is cut to the limits and the enrichment still returned', async () => {
    const huge = 'x'.repeat(1_000_000);
    await enable({ docs: { hooks: { lessonStarted: (_p, ctx) => {
      for (let i = 0; i < 5000; i++) ctx.trace.note(huge);
      return { ...ENRICHMENT, trace: Array.from({ length: 5000 }, () => ({ type: 'ai', system: huge, messages: [{ role: 'user', content: huge }], reply: huge })) };
    } } } });
    const { status, data } = await start({ trace: true });
    assert.equal(status, 200);
    assert.deepEqual(data.enrichments, [ENRICHMENT]);
    const steps = data.pluginTraces.docs;
    assert.ok(steps.length <= TRACE_LIMITS.steps + 1);
    assert.ok(Buffer.byteLength(JSON.stringify(steps)) <= TRACE_LIMITS.bytes);
    assert.match(steps.at(-1).text, /left out/);
    assert.ok(steps.every((s) => JSON.stringify(s).length < TRACE_LIMITS.text * 3));
  });

  it('a plugin that throws leaves what it had recorded, and lesson start goes on', async () => {
    await enable({
      broken: { hooks: { lessonStarted: (_p, ctx) => { ctx.trace.note('Started.'); throw new Error('search is down'); } } },
      docs: { hooks: { lessonStarted: () => ({ ...ENRICHMENT }) } },
    });
    const { status, data } = await start({ trace: true });
    assert.equal(status, 200);
    assert.deepEqual(data.enrichments, [ENRICHMENT]);
    assert.deepEqual(data.pluginTraces, { broken: [{ type: 'note', text: 'Started.' }, { type: 'note', text: 'The plugin stopped with an error: search is down' }] });
  });

  it('two learners starting at once get only their own steps', async () => {
    await enable({ docs: { hooks: { lessonStarted: async ({ lessonId }, ctx) => {
      for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, Math.random() * 8)); ctx.trace.note(`${lessonId} ${i}`); }
      return { ...ENRICHMENT, context: lessonId };
    } } } });
    const ids = ['lesson-a', 'lesson-b', 'lesson-c', 'lesson-d'];
    const all = await Promise.all(ids.map((lessonId, n) => start({ lessonId, ...(n === 3 ? {} : { trace: true }) })));
    ids.slice(0, 3).forEach((lessonId, n) => {
      assert.deepEqual(all[n].data.pluginTraces.docs.map((s) => s.text), [0, 1, 2, 3].map((i) => `${lessonId} ${i}`));
      assert.equal(all[n].data.enrichments[0].context, lessonId);
    });
    assert.deepEqual(Object.keys(all[3].data), ['enrichments', 'startupSteps'], 'the untraced one, started alongside, gets none');
  });

  it('a disabled plugin does nothing and reports nothing', async () => {
    await enable({ docs: { hooks: { lessonStarted: (_p, ctx) => { ctx.trace.note('ran'); return { ...ENRICHMENT }; } } } });
    await pluginRegistry.setEnabled('docs', false);
    const { data } = await start({ trace: true });
    assert.deepEqual(data, { enrichments: [], startupSteps: [], pluginTraces: {} });
  });

  it('a handler registered outside the registry is unaffected', async () => {
    on('lessonStarted', () => ({ ...ENRICHMENT, trace: [{ type: 'note', text: 'no plugin id to file this under' }] }));
    const { data } = await start({ trace: true });
    assert.deepEqual(data, { enrichments: [ENRICHMENT], startupSteps: [], pluginTraces: {} });
  });

  it('other hooks never get a recorder', async () => {
    let ctxSeen;
    await enable({ docs: { hooks: { lessonCompleted: (_p, ctx) => { ctxSeen = ctx; } } } });
    const { emit } = await import('../../src/lib/plugins/hooks.js');
    const { createTraceCollector } = await import('../../src/lib/plugins/trace.js');
    await emit('lessonCompleted', { userId }, { traceCollector: createTraceCollector() });
    assert.equal(ctxSeen.trace.on, false);
    assert.equal(ctxSeen.ai, ai);
  });
});

describe('WordPress Info, traced', () => {
  const PLAN = { shouldEnrich: true, reasoning: 'About blocks', queries: [{ text: 'register block type', sources: ['wporg-docs', 'make-blogs', 'github-code'] }] };
  const SYNTHESIS = { context: 'Use register_block_type().', reasoning: 'The lesson registers a block.' };

  function fakeWorld({ plan = PLAN } = {}) {
    const calls = { ai: [], fetch: [] };
    ai.invoke = async (model, body, opts) => {
      calls.ai.push({ model, body, opts });
      const text = calls.ai.length === 1 ? JSON.stringify(plan) : JSON.stringify(SYNTHESIS);
      return { content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: 'end_turn' };
    };
    globalThis.fetch = async (url, init) => {
      calls.fetch.push({ url: String(url), headers: init?.headers });
      const host = new URL(url).hostname;
      if (host === 'developer.wordpress.org') return Response.json([{ url: 'https://developer.wordpress.org/reference/functions/register_block_type/', title: 'register_block_type()', _embedded: { self: [{ excerpt: '<p>Registers a block type.</p>' }] } }]);
      if (host === 'make.wordpress.org') return new Response('nope', { status: 503 });
      return Response.json({ items: [{ html_url: 'https://github.com/WordPress/WordPress/blob/master/wp-includes/blocks.php', name: 'blocks.php', path: 'wp-includes/blocks.php', repository: { full_name: 'WordPress/WordPress' } }] });
    };
    return calls;
  }

  it('returns its planner and synthesiser calls and every search, and the same enrichment as untraced', async () => {
    await enable({ 'wordpress-info': wordpressInfo });

    const offCalls = fakeWorld();
    const off = await start({});
    const onCalls = fakeWorld();
    const traced = await start({ trace: true });

    assert.deepEqual(Object.keys(off.data), ['enrichments', 'startupSteps']);
    assert.equal(off.data.enrichments.length, 1);
    assert.equal(off.data.enrichments[0].context, SYNTHESIS.context);
    assert.deepEqual(traced.data.enrichments, off.data.enrichments, 'tracing changes nothing the coach is given');
    assert.deepEqual(onCalls.ai.map((c) => c.body), offCalls.ai.map((c) => c.body), 'the same AI requests');
    assert.deepEqual(onCalls.fetch.map((c) => c.url).sort(), offCalls.fetch.map((c) => c.url).sort(), 'the same searches');
    assert.equal(offCalls.fetch.length, 5);

    const steps = traced.data.pluginTraces['wordpress-info'];
    assert.deepEqual(steps.map((s) => s.type), ['ai', 'fetch', 'fetch', 'fetch', 'fetch', 'fetch', 'note', 'ai']);

    const [planner, synthesiser] = steps.filter((s) => s.type === 'ai');
    assert.match(planner.purpose, /^Planner/);
    assert.equal(planner.messages[0].content, onCalls.ai[0].body.messages[0].content, 'exactly what was sent');
    assert.equal(planner.reply, JSON.stringify(PLAN));
    assert.deepEqual(planner.usage, { input_tokens: 100, output_tokens: 20 });
    assert.match(synthesiser.purpose, /^Synthesiser/);
    assert.equal(synthesiser.messages[0].content, onCalls.ai[1].body.messages[0].content);
    assert.match(synthesiser.messages[0].content, /register_block_type\(\)/);
    assert.equal(synthesiser.reply, JSON.stringify(SYNTHESIS));

    const fetches = steps.filter((s) => s.type === 'fetch');
    assert.deepEqual(fetches.map((s) => s.url).sort(), onCalls.fetch.map((c) => c.url).sort(), 'every outbound request, by URL');
    assert.deepEqual([...new Set(fetches.map((s) => new URL(s.url).hostname))].sort(), ['api.github.com', 'developer.wordpress.org', 'make.wordpress.org']);
    assert.deepEqual(fetches.filter((s) => new URL(s.url).hostname === 'make.wordpress.org').map((s) => s.status), [503, 503, 503]);
    assert.ok(fetches.every((s) => /^Search .+ for “register block type”$/.test(s.purpose)));
    assert.ok(fetches.every((s) => Object.keys(s).every((k) => ['type', 'purpose', 'url', 'status', 'ms', 'bytes'].includes(k))), 'no headers, no bodies');
    assert.match(steps.find((s) => s.type === 'note').text, /1 search query returned 2 results/);
  });

  it('a lesson that isn’t about WordPress shows the planner’s call and why nothing was added', async () => {
    await enable({ 'wordpress-info': wordpressInfo });
    const calls = fakeWorld({ plan: { shouldEnrich: false, reasoning: 'Not WordPress' } });
    const { data } = await start({ trace: true });
    assert.deepEqual(data.enrichments, []);
    assert.equal(calls.fetch.length, 0);
    const steps = data.pluginTraces['wordpress-info'];
    assert.deepEqual(steps.map((s) => s.type), ['ai', 'note']);
    assert.match(steps[1].text, /nothing was searched/);
  });

  it('an AI failure is in the trace and lesson start goes on', async () => {
    await enable({ 'wordpress-info': wordpressInfo });
    ai.invoke = async () => { const e = new Error('Too many requests'); e.name = 'ThrottlingException'; throw e; };
    const { status, data } = await start({ trace: true });
    assert.equal(status, 200);
    assert.deepEqual(data.enrichments, []);
    const steps = data.pluginTraces['wordpress-info'];
    assert.equal(steps[0].type, 'ai');
    assert.equal(steps[0].error, 'ThrottlingException: Too many requests');
    assert.match(steps.at(-1).text, /stopped with an error/);
  });

  it('untraced, and on a host without `ctx.trace`, it runs as it always did', async () => {
    const calls = fakeWorld();
    const result = await wordpressInfo.hooks.lessonStarted({ userId, lessonId: 'blocks', lesson: LESSON, lessonKB: {} }, { ai, LLM: 'qwen3-vl-235b' });
    assert.equal(result.context, SYNTHESIS.context);
    assert.equal(result.sources.length, 2);
    assert.ok(!('trace' in result));
    assert.equal(calls.fetch.length, 5);
  });
});
