/**
 * Trace mode for plugins (#595): what a plugin reports about a lesson start
 * is cleaned and bounded before it leaves the server, a recorder belongs to
 * one call, and nothing here can throw into lesson start.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACE_LIMITS, sanitizeStep, sanitizeSteps, scrubSecrets, cleanUrl,
  createRecorder, createTraceCollector, NO_TRACE,
} from '../../../src/lib/plugins/trace.js';

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

describe('sanitizeStep', () => {
  it('keeps an AI step’s known fields and drops the rest', () => {
    const step = sanitizeStep({
      type: 'ai', purpose: 'Plan', model: 'qwen3-vl-235b', system: 'Be brief.',
      messages: [{ role: 'user', content: 'Hello', secret: 'x' }], reply: 'Hi', usage: { input_tokens: 3, output_tokens: 1, note: 'n' },
      ms: 12.4, headers: { authorization: 'Bearer abcdefghijkl' }, apiKey: 'k',
    });
    assert.deepEqual(step, {
      type: 'ai', purpose: 'Plan', model: 'qwen3-vl-235b', system: 'Be brief.',
      messages: [{ role: 'user', content: 'Hello' }], reply: 'Hi', usage: { input_tokens: 3, output_tokens: 1 }, ms: 12,
    });
  });

  it('gives an AI step every required field, even from a bare one', () => {
    assert.deepEqual(sanitizeStep({ type: 'ai' }), { type: 'ai', purpose: '', model: '', system: '', messages: [], reply: '' });
  });

  it('reads content blocks as text and names attachments instead of copying them', () => {
    const step = sanitizeStep({
      type: 'ai', system: [{ type: 'text', text: 'S1' }, { type: 'text', text: 'S2' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', source: { data: 'A'.repeat(5000) } }] }],
      reply: [{ type: 'text', text: 'Seen' }],
    });
    assert.equal(step.system, 'S1\nS2');
    assert.equal(step.messages[0].content, 'Look\n[image]');
    assert.equal(step.reply, 'Seen');
  });

  it('keeps a fetch step’s URL without credentials, and nothing else that could carry one', () => {
    const step = sanitizeStep({
      type: 'fetch', purpose: 'Search', url: 'https://user:pass@api.example.com/search?q=hooks&api_key=SECRET1&access_token=SECRET2&author=5#frag',
      status: 200, ms: 40, bytes: 1234, headers: { Authorization: 'Bearer SECRET3' }, body: 'SECRET4',
    });
    assert.equal(step.url, 'https://api.example.com/search?q=hooks&api_key=%5Bremoved%5D&access_token=%5Bremoved%5D&author=5');
    assert.deepEqual(Object.keys(step), ['type', 'purpose', 'url', 'status', 'ms', 'bytes']);
    assert.doesNotMatch(JSON.stringify(step), /SECRET|pass@/);
  });

  it('drops a fetch step whose URL isn’t an http(s) URL', () => {
    assert.equal(sanitizeStep({ type: 'fetch', url: 'file:///etc/passwd' }), null);
    assert.equal(sanitizeStep({ type: 'fetch', url: 'not a url' }), null);
    assert.equal(sanitizeStep({ type: 'fetch' }), null);
    assert.equal(cleanUrl('javascript:alert(1)'), null);
  });

  it('keeps a note with text and drops an empty one', () => {
    assert.deepEqual(sanitizeStep({ type: 'note', text: 'Nothing found.', extra: 1 }), { type: 'note', text: 'Nothing found.' });
    assert.equal(sanitizeStep({ type: 'note', text: '' }), null);
    assert.equal(sanitizeStep({ type: 'note' }), null);
  });

  it('drops unknown types and anything that isn’t a plain object', () => {
    for (const bad of [null, undefined, 'note', 7, [], [{ type: 'note', text: 'x' }], { type: 'shell', cmd: 'rm' }, { text: 'no type' }, () => {}]) {
      assert.equal(sanitizeStep(bad), null);
    }
  });

  it('caps each text field and says how much was left out', () => {
    const long = 'a'.repeat(TRACE_LIMITS.text + 500);
    const step = sanitizeStep({ type: 'ai', purpose: 'p'.repeat(5000), system: long, messages: [{ role: 'user', content: long }], reply: long });
    for (const text of [step.system, step.messages[0].content, step.reply]) {
      assert.ok(text.length < TRACE_LIMITS.text + 60);
      assert.match(text, /… \[500 more characters left out\]$/);
    }
    assert.ok(step.purpose.length < TRACE_LIMITS.short + 60);
    assert.match(sanitizeStep({ type: 'note', text: long }).text, /500 more characters left out/);
  });

  it('caps the messages in one AI step', () => {
    const step = sanitizeStep({ type: 'ai', messages: Array.from({ length: 500 }, (_, i) => ({ role: 'user', content: `m${i}` })) });
    assert.equal(step.messages.length, TRACE_LIMITS.messages);
  });

  it('ignores numbers that aren’t counts', () => {
    const step = sanitizeStep({ type: 'fetch', url: 'https://example.com/', status: 'ok', ms: -4, bytes: Infinity });
    assert.deepEqual(step, { type: 'fetch', purpose: '', url: 'https://example.com/' });
  });

  it('never throws, whatever it is given', () => {
    const hostile = { type: 'ai', get system() { throw new Error('boom'); } };
    assert.equal(sanitizeStep(hostile), null);
    const circular = { type: 'note' }; circular.text = circular;
    assert.equal(sanitizeStep(circular), null);
    assert.doesNotThrow(() => sanitizeStep({ type: 'ai', messages: [{ role: {}, content: { toString() { throw new Error('x'); } } }] }));
    assert.doesNotThrow(() => sanitizeStep(new Proxy({}, { get() { throw new Error('proxy'); } })));
  });
});

describe('scrubSecrets', () => {
  it('removes credentials written into text', () => {
    const text = [
      'Authorization: Bearer abc.def-ghi_123456',
      'x-api-key: sk-live-0000',
      '"authorization": "Basic dXNlcjpwYXNzd29yZA=="',
      'X-Slack-Token=xoxb-123-456',
      'Cookie: session=abc123; other=1',
      'sent with Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig in the header',
    ].join('\n');
    const out = scrubSecrets(text);
    assert.doesNotMatch(out, /abc\.def|sk-live|dXNlcjpw|xoxb|abc123|eyJhbGci/);
    assert.equal(out.split('[removed]').length - 1, 6);
  });

  it('leaves ordinary lesson text alone', () => {
    const text = 'A cookie is a small file. The author writes a key idea: hooks. Bearer of news.\nCookie: a small file a site stores.';
    assert.equal(scrubSecrets(text), text);
  });
});

describe('sanitizeSteps', () => {
  const note = (i) => ({ type: 'note', text: `step ${i}` });

  it('keeps known steps in order and drops the rest', () => {
    const out = sanitizeSteps([note(1), { type: 'mystery' }, null, { type: 'fetch', url: 'https://example.com/a', status: 200 }, 'x', note(2)]);
    assert.deepEqual(out.map((s) => s.type), ['note', 'fetch', 'note']);
    assert.equal(out[2].text, 'step 2');
  });

  it('is an empty trace for anything that isn’t a list', () => {
    for (const bad of [undefined, null, 'steps', 5, {}, { length: 3 }, { type: 'note', text: 'x' }]) assert.deepEqual(sanitizeSteps(bad), []);
  });

  it('caps the number of steps and says some were left out', () => {
    const out = sanitizeSteps(Array.from({ length: 500 }, (_, i) => note(i)));
    assert.equal(out.length, TRACE_LIMITS.steps + 1);
    assert.equal(out[TRACE_LIMITS.steps - 1].text, `step ${TRACE_LIMITS.steps - 1}`);
    assert.match(out.at(-1).text, /left out/);
  });

  it('exactly the limit is kept whole, with no closing note', () => {
    const out = sanitizeSteps(Array.from({ length: TRACE_LIMITS.steps }, (_, i) => note(i)));
    assert.equal(out.length, TRACE_LIMITS.steps);
    assert.doesNotMatch(out.at(-1).text, /left out/);
  });

  it('caps the whole trace’s size', () => {
    const big = { type: 'ai', system: 's'.repeat(TRACE_LIMITS.text), messages: [{ role: 'user', content: 'm'.repeat(TRACE_LIMITS.text) }], reply: 'r'.repeat(TRACE_LIMITS.text) };
    const out = sanitizeSteps(Array.from({ length: 40 }, () => big));
    assert.ok(bytes(out) <= TRACE_LIMITS.bytes, `${bytes(out)} bytes`);
    assert.ok(out.length < 40 && out.length > 1);
    assert.match(out.at(-1).text, /left out/);
  });

  it('measures size in bytes, not characters', () => {
    const out = sanitizeSteps(Array.from({ length: 40 }, () => ({ type: 'note', text: '語'.repeat(TRACE_LIMITS.text) })));
    assert.ok(bytes(out) <= TRACE_LIMITS.bytes, `${bytes(out)} bytes`);
  });

  it('doesn’t walk an abusive list to its end', () => {
    let reads = 0;
    const huge = new Proxy([], { get(t, k) { if (k === 'length') return 1e9; reads++; return { type: 'mystery' }; } });
    sanitizeSteps(huge);
    assert.ok(reads <= TRACE_LIMITS.steps * 20 + 5, `${reads} reads`);
  });

  it('never throws', () => {
    const hostile = new Proxy([], { get() { throw new Error('boom'); } });
    assert.deepEqual(sanitizeSteps(hostile), []);
  });
});

describe('the recorder (ctx.trace on a traced call)', () => {
  const fakeAi = (reply = 'OK') => ({
    describe: () => ({ provider: 'fake' }),
    calls: [],
    async invoke(model, body, opts) { this.calls.push({ model, body, opts }); return { content: [{ type: 'text', text: reply }], usage: { input_tokens: 5, output_tokens: 2 }, stop_reason: 'end_turn' }; },
    async *invokeStream() {
      yield { type: 'content_block_delta', delta: { type: 'reasoning_delta', text: 'thinking' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } };
      yield { type: 'message_delta', usage: { input_tokens: 1, output_tokens: 2 } };
    },
  });

  it('records cleaned steps in order', () => {
    const steps = [];
    const rec = createRecorder({ steps });
    assert.equal(rec.on, true);
    rec.note('first');
    rec.record({ type: 'fetch', purpose: 'p', url: 'https://example.com/?token=abc', status: 200 });
    rec.record({ type: 'bogus' });
    rec.record(null);
    assert.deepEqual(steps.map((s) => s.type), ['note', 'fetch']);
    assert.doesNotMatch(steps[1].url, /abc/);
  });

  it('records each AI call made through its `ai`, and returns the provider’s reply untouched', async () => {
    const ai = fakeAi('{"shouldEnrich":true}');
    const steps = [];
    const rec = createRecorder({ steps, ai });
    const body = { max_tokens: 100, system: 'Be brief.', messages: [{ role: 'user', content: 'Plan it' }] };
    const res = await rec.ai.invoke('qwen3-vl-235b', body, { purpose: 'Planner' });
    assert.deepEqual(res, { content: [{ type: 'text', text: '{"shouldEnrich":true}' }], usage: { input_tokens: 5, output_tokens: 2 }, stop_reason: 'end_turn' });
    assert.deepEqual(ai.calls[0], { model: 'qwen3-vl-235b', body, opts: { purpose: 'Planner' } }, 'the provider gets what the plugin passed');
    assert.equal(steps.length, 1);
    const { ms, ...step } = steps[0];
    assert.equal(typeof ms, 'number');
    assert.deepEqual(step, { type: 'ai', purpose: 'Planner', model: 'qwen3-vl-235b', system: 'Be brief.', messages: [{ role: 'user', content: 'Plan it' }], reply: '{"shouldEnrich":true}', usage: { input_tokens: 5, output_tokens: 2 } });
    assert.deepEqual(rec.ai.describe(), { provider: 'fake' }, 'the rest of the provider is still there');
  });

  it('records a failed AI call without AWS identifiers, and rethrows', async () => {
    const ai = { async invoke() { const e = new Error('denied for arn:aws:bedrock:us-east-2:123456789012:model/x in 123456789012'); e.name = 'AccessDeniedException'; throw e; } };
    const steps = [];
    const rec = createRecorder({ steps, ai });
    await assert.rejects(() => rec.ai.invoke('m', { messages: [] }), /denied/);
    assert.equal(steps[0].reply, '');
    assert.match(steps[0].error, /^AccessDeniedException: denied for \[arn\] in \[account\]$/);
  });

  it('records a streamed AI call once, with the text that was streamed', async () => {
    const steps = [];
    const rec = createRecorder({ steps, ai: fakeAi() });
    const seen = [];
    for await (const e of rec.ai.invokeStream('m', { messages: [{ role: 'user', content: 'Hi' }] }, { purpose: 'Stream' })) seen.push(e.type);
    assert.equal(seen.length, 4);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].reply, 'Hello');
    assert.deepEqual(steps[0].usage, { input_tokens: 1, output_tokens: 2 });
  });

  it('`fetch` returns the response untouched and records URL, status, time and stated size', async () => {
    const steps = [];
    const response = new Response('{"a":1}', { status: 201, headers: { 'content-length': '7' } });
    const calls = [];
    const rec = createRecorder({ steps, fetchImpl: async (url, init) => { calls.push({ url, init }); return response; } });
    const init = { headers: { Authorization: 'Bearer TOPSECRETTOKEN' } };
    const res = await rec.fetch('Search docs', 'https://api.example.com/x?q=1', init);
    assert.equal(res, response);
    assert.deepEqual(calls, [{ url: 'https://api.example.com/x?q=1', init }]);
    const { ms, ...step } = steps[0];
    assert.equal(typeof ms, 'number');
    assert.deepEqual(step, { type: 'fetch', purpose: 'Search docs', url: 'https://api.example.com/x?q=1', status: 201, bytes: 7 });
    assert.doesNotMatch(JSON.stringify(steps), /TOPSECRET/);
  });

  it('`fetch` records a failure and rethrows it', async () => {
    const steps = [];
    const rec = createRecorder({ steps, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    await assert.rejects(() => rec.fetch('Search', 'https://api.example.com/'), /ECONNRESET/);
    assert.equal(steps[0].error, 'ECONNRESET');
    assert.equal(steps[0].status, undefined);
  });

  it('stops holding steps once it is full', () => {
    const steps = [];
    const rec = createRecorder({ steps });
    for (let i = 0; i < 10_000; i++) rec.note(`n${i}`);
    assert.equal(steps.length, TRACE_LIMITS.steps + 1);
  });

  it('never throws into the plugin', () => {
    const rec = createRecorder({ steps: [] });
    assert.doesNotThrow(() => rec.record(new Proxy({}, { get() { throw new Error('x'); } })));
    assert.doesNotThrow(() => rec.note({ toString() { throw new Error('x'); } }));
  });
});

describe('the untraced stand-in', () => {
  it('records nothing and fetches plainly', async () => {
    assert.equal(NO_TRACE.on, false);
    assert.equal(NO_TRACE.record({ type: 'note', text: 'x' }), undefined);
    assert.equal(NO_TRACE.note('x'), undefined);
    assert.equal(NO_TRACE.ai, undefined);
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push([url, init]); return 'response'; };
    try {
      assert.equal(await NO_TRACE.fetch('purpose', 'https://example.com/', { method: 'GET' }), 'response');
      assert.deepEqual(calls, [['https://example.com/', { method: 'GET' }]]);
    } finally { globalThis.fetch = real; }
  });
});

describe('the collector (one per traced lesson start)', () => {
  it('keeps each plugin’s steps apart, recorded steps before returned ones', () => {
    const c = createTraceCollector();
    c.recorderFor('plugin-a').note('a1');
    c.recorderFor('plugin-b').note('b1');
    c.addReturned('plugin-a', [{ type: 'note', text: 'a2' }, { type: 'nope' }]);
    assert.deepEqual(c.result(), {
      'plugin-a': [{ type: 'note', text: 'a1' }, { type: 'note', text: 'a2' }],
      'plugin-b': [{ type: 'note', text: 'b1' }],
    });
  });

  it('two calls at once never see each other’s steps', async () => {
    const run = async (learner) => {
      const c = createTraceCollector();
      const rec = c.recorderFor('wordpress-info');
      for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, Math.random() * 5)); rec.note(`${learner} ${i}`); }
      return c.result()['wordpress-info'].map((s) => s.text);
    };
    const [a, b] = await Promise.all([run('ada'), run('grace')]);
    assert.deepEqual(a, [0, 1, 2, 3, 4].map((i) => `ada ${i}`));
    assert.deepEqual(b, [0, 1, 2, 3, 4].map((i) => `grace ${i}`));
  });

  it('leaves out plugins that recorded nothing, and bad returns', () => {
    const c = createTraceCollector();
    c.recorderFor('quiet');
    c.addReturned('junk', 'not a list');
    c.addReturned('junk', { type: 'note', text: 'x' });
    c.addReturned('Bad Id!', [{ type: 'note', text: 'x' }]);
    assert.deepEqual(c.result(), {});
  });

  it('bounds a plugin’s trace, however the steps arrived', () => {
    const c = createTraceCollector();
    const rec = c.recorderFor('loud');
    for (let i = 0; i < 200; i++) rec.note(`r${i}`);
    c.addReturned('loud', Array.from({ length: 200 }, (_, i) => ({ type: 'note', text: `x${i}` })));
    const steps = c.result().loud;
    assert.equal(steps.length, TRACE_LIMITS.steps + 1);
    assert.match(steps.at(-1).text, /left out/);
  });

  it('holds all plugins together under what one trace record can store', () => {
    const c = createTraceCollector();
    const big = { type: 'note', text: 'x'.repeat(TRACE_LIMITS.text) };
    for (const id of ['p1', 'p2', 'p3', 'p4']) c.addReturned(id, Array.from({ length: 30 }, () => big));
    const out = c.result();
    assert.deepEqual(Object.keys(out), ['p1', 'p2', 'p3', 'p4']);
    assert.ok(bytes(out) <= TRACE_LIMITS.totalBytes + 200, `${bytes(out)} bytes`);
    for (const steps of Object.values(out)) assert.ok(steps.length > 1, 'each plugin keeps a share');
  });

  it('a lone plugin gets the full per-plugin size', () => {
    const c = createTraceCollector();
    c.addReturned('p1', Array.from({ length: 30 }, () => ({ type: 'note', text: 'x'.repeat(TRACE_LIMITS.text) })));
    const size = bytes(c.result().p1);
    assert.ok(size <= TRACE_LIMITS.bytes && size > TRACE_LIMITS.bytes - 25_000, `${size} bytes`);
  });
});
