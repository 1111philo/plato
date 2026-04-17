import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../../src/lib/logger.js';

// Silence the stdout mirror so test output stays clean.
const origErr = console.error;
const origWarn = console.warn;
console.error = () => {};
console.warn = () => {};

describe('logger', () => {
  beforeEach(() => {
    logger._reset();
    delete process.env.LOG_BUFFER_SIZE;
  });

  it('stores entries in the ring buffer with stable code', () => {
    logger.error('unhandled_error', { path: '/x' });
    logger.warn('seed_failed', { error: 'oops' });
    const entries = logger.recent();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].code, 'seed_failed');
    assert.equal(entries[1].code, 'unhandled_error');
    assert.ok(entries[0].logId.startsWith('log_'));
  });

  it('coerces non-snake-case codes and emits logger_bad_code', () => {
    logger.error('Unhandled Error!', { foo: 1 });
    const entries = logger.recent();
    const codes = entries.map((e) => e.code);
    assert.ok(codes.includes('unhandled_error'));
    assert.ok(codes.includes('logger_bad_code'));
    const bad = entries.find((e) => e.code === 'logger_bad_code');
    assert.equal(bad.meta.attempted, 'Unhandled Error!');
    assert.equal(bad.meta.coerced, 'unhandled_error');
  });

  it('truncates stack traces to 10 frames', () => {
    const frames = Array.from({ length: 30 }, (_, i) => `    at fn${i} (file.js:${i}:1)`).join('\n');
    logger.error('big_stack', { stack: `Error: boom\n${frames}` });
    const [entry] = logger.recent();
    const lines = entry.meta.stack.split('\n');
    assert.equal(lines.length, 10);
  });

  it('truncates meta larger than 2KB', () => {
    const huge = 'x'.repeat(5000);
    logger.error('big_meta', { blob: huge });
    const [entry] = logger.recent();
    assert.ok(entry.meta._truncated);
    assert.ok(entry.meta.preview.length <= 2048);
  });

  it('evicts oldest entries when buffer is full', () => {
    process.env.LOG_BUFFER_SIZE = '3';
    logger._reset();
    for (let i = 0; i < 5; i++) logger.error('evict_test', { i });
    const entries = logger.recent();
    assert.equal(entries.length, 3);
    const iValues = entries.map((e) => e.meta.i).sort((a, b) => a - b);
    assert.deepEqual(iValues, [2, 3, 4]);
  });

  it('filters recent() by level and since', async () => {
    const mid = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    logger.error('later_err');
    logger.warn('later_warn');

    const onlyErrors = logger.recent({ level: 'error' });
    assert.equal(onlyErrors.length, 1);
    assert.equal(onlyErrors[0].code, 'later_err');

    const since = logger.recent({ since: mid });
    assert.equal(since.length, 2);
  });

  it('groups() aggregates by code with count/firstSeen/lastSeen', async () => {
    logger.error('ai_stream_error');
    await new Promise((r) => setTimeout(r, 2));
    logger.error('ai_stream_error');
    await new Promise((r) => setTimeout(r, 2));
    logger.error('unhandled_error');

    const groups = logger.groups();
    assert.equal(groups.length, 2);
    assert.equal(groups[0].code, 'ai_stream_error');
    assert.equal(groups[0].count, 2);
    assert.ok(groups[0].firstSeen < groups[0].lastSeen);
    assert.equal(groups[0].sources[0], 'buffer');
    assert.equal(groups[1].code, 'unhandled_error');
    assert.equal(groups[1].count, 1);
  });
});

// Restore console for subsequent test files.
process.on('exit', () => {
  console.error = origErr;
  console.warn = origWarn;
});
