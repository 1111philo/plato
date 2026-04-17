import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, logGroupPrefix } from '../../src/lib/cloudwatch-logs.js';

describe('normalizeEvent', () => {
  it('preserves the logger-emitted logId so buffer + CloudWatch dedupe', () => {
    // The logger writes `{"logId":"log_123...","level":"error","code":"unhandled_error",...}`
    // to stdout. Lambda forwards that line into CloudWatch. When the endpoint
    // pulls the event back, normalizeEvent must use the *same* logId so the
    // merge-by-logId step in admin.js coalesces the two sources.
    const event = {
      eventId: 'cw-event-42',
      timestamp: Date.parse('2026-04-17T14:00:00Z'),
      logStreamName: 'stream/abc',
      message: '2026-04-17T14:00:00.123Z\tabc-req-id\tERROR\t{"logId":"log_1111_abcxyz","level":"error","code":"unhandled_error","path":"/x"}',
    };
    const normalized = normalizeEvent(event, '/aws/lambda/plato-prod-api');
    assert.equal(normalized.logId, 'log_1111_abcxyz');
    assert.equal(normalized.code, 'unhandled_error');
    assert.equal(normalized.level, 'error');
    assert.equal(normalized.source, 'cloudwatch');
    assert.equal(normalized.meta.path, '/x');
    assert.equal(normalized.meta.logGroup, '/aws/lambda/plato-prod-api');
  });

  it('falls back to cw_* id and cloudwatch_raw code for unstructured lines', () => {
    const event = {
      eventId: 'cw-event-99',
      timestamp: Date.parse('2026-04-17T14:00:00Z'),
      logStreamName: 'stream/abc',
      message: '2026-04-17T14:00:00.000Z  abc-req  Task timed out after 30.02 seconds',
    };
    const normalized = normalizeEvent(event, '/aws/lambda/plato-prod-stream');
    assert.equal(normalized.logId, 'cw_cw-event-99');
    assert.equal(normalized.code, 'cloudwatch_raw');
    assert.equal(normalized.level, 'error');
    assert.ok(normalized.meta.message.includes('Task timed out'));
  });

  it('returns null for Lambda lifecycle noise (START/END/REPORT)', () => {
    for (const msg of ['START RequestId: abc Version: $LATEST', 'END RequestId: abc', 'REPORT RequestId: abc Duration: 12 ms', 'INIT_START Runtime Version: nodejs:20']) {
      const event = { eventId: 'x', timestamp: Date.now(), logStreamName: 's', message: msg };
      assert.equal(normalizeEvent(event, 'g'), null, `should drop: ${msg}`);
    }
  });
});

describe('logGroupPrefix', () => {
  let origStage;
  beforeEach(() => { origStage = process.env.STAGE; });
  afterEach(() => { if (origStage !== undefined) process.env.STAGE = origStage; else delete process.env.STAGE; });

  it('matches the CloudFormation naming: prod stack is named "plato"', () => {
    process.env.STAGE = 'prod';
    // Actual Lambda log group is e.g. `/aws/lambda/plato-PlatoApiFunction-xIsSx1fu8kWd`.
    // The old prefix `/aws/lambda/plato-prod-` would never match — CloudFormation
    // gives the prod stack the bare name `plato`, not `plato-prod`.
    assert.equal(logGroupPrefix(), '/aws/lambda/plato-');
  });

  it('includes the stage for non-prod stacks (playground → plato-playground)', () => {
    process.env.STAGE = 'playground';
    assert.equal(logGroupPrefix(), '/aws/lambda/plato-playground-');
  });
});
