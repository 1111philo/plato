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
});

// Restore console after suite (node:test runs in series, so this is fine).
process.on('exit', () => { console.error = origErr; console.warn = origWarn; });
