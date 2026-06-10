import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { on, emit, listEvents, handlerCount, _reset } from '../../../src/lib/plugins/hooks.js';

// Silence error mirror.
const origErr = console.error;
const origWarn = console.warn;
console.error = () => {};
console.warn = () => {};

describe('hooks pub-sub', () => {
  beforeEach(() => _reset());

  it('fans out an emit to every subscriber', async () => {
    const calls = [];
    on('userCreated', (p) => { calls.push(['a', p]); });
    on('userCreated', (p) => { calls.push(['b', p]); });
    await emit('userCreated', { userId: 'u1' });
    assert.deepEqual(calls, [['a', { userId: 'u1' }], ['b', { userId: 'u1' }]]);
  });

  it('emit awaits async handlers', async () => {
    let order = [];
    on('lessonStarted', async () => { await new Promise(r => setTimeout(r, 5)); order.push('a'); });
    on('lessonStarted', () => { order.push('b'); });
    await emit('lessonStarted', {});
    assert.deepEqual(order, ['a', 'b']);
  });

  it('one handler error does not stop others', async () => {
    const seen = [];
    on('userCreated', () => { throw new Error('boom'); });
    on('userCreated', (p) => { seen.push(p); });
    await emit('userCreated', { userId: 'u2' });
    assert.deepEqual(seen, [{ userId: 'u2' }]);
  });

  it('open bus accepts any event name', async () => {
    const seen = [];
    on('my-plugin.custom-event', (p) => seen.push(p));
    await emit('my-plugin.custom-event', { ok: true });
    assert.deepEqual(seen, [{ ok: true }]);
  });

  it('unsubscribe removes a handler', async () => {
    const seen = [];
    const off = on('userCreated', (p) => seen.push(p));
    off();
    await emit('userCreated', { userId: 'gone' });
    assert.deepEqual(seen, []);
  });

  it('listEvents and handlerCount expose state', () => {
    on('lessonStarted', () => {});
    on('lessonStarted', () => {});
    on('userCreated', () => {});
    assert.deepEqual(listEvents(), ['lessonStarted', 'userCreated']);
    assert.equal(handlerCount('lessonStarted'), 2);
    assert.equal(handlerCount('nope'), 0);
  });

  it('emit collects non-null return values from handlers', async () => {
    on('lessonStarted', () => ({ pluginId: 'a', context: 'Context A' }));
    on('lessonStarted', () => null); // Null returns are filtered out
    on('lessonStarted', () => ({ pluginId: 'b', context: 'Context B' }));
    on('lessonStarted', () => undefined); // Undefined returns are filtered out

    const results = await emit('lessonStarted', { lessonId: 'l1' });

    assert.equal(results.length, 2);
    assert.deepEqual(results[0], { pluginId: 'a', context: 'Context A' });
    assert.deepEqual(results[1], { pluginId: 'b', context: 'Context B' });
  });

  it('emit returns empty array when no handlers registered', async () => {
    const results = await emit('noHandlers', {});
    assert.deepEqual(results, []);
  });

  it('emit collects async handler return values', async () => {
    on('lessonStarted', async () => {
      await new Promise(r => setTimeout(r, 5));
      return { pluginId: 'async', context: 'Async context' };
    });
    on('lessonStarted', () => ({ pluginId: 'sync', context: 'Sync context' }));

    const results = await emit('lessonStarted', {});

    assert.equal(results.length, 2);
    assert.equal(results[0].pluginId, 'async');
    assert.equal(results[1].pluginId, 'sync');
  });

  it('handler errors do not prevent other return values from being collected', async () => {
    on('lessonStarted', () => ({ pluginId: 'good1', context: 'Good' }));
    on('lessonStarted', () => { throw new Error('boom'); });
    on('lessonStarted', () => ({ pluginId: 'good2', context: 'Also good' }));

    const results = await emit('lessonStarted', {});

    assert.equal(results.length, 2);
    assert.equal(results[0].pluginId, 'good1');
    assert.equal(results[1].pluginId, 'good2');
  });
});

// Restore console after suite (node:test runs in series, so this is fine).
process.on('exit', () => { console.error = origErr; console.warn = origWarn; });
