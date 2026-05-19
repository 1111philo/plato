import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvent, logGroupPrefix, belongsToStage,
  isProcessWarning, filterAllPages,
} from '../../src/lib/cloudwatch-logs.js';

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

  it('drops Node process warnings — they are not application errors', () => {
    // Lambda prefixes these stderr lines with "ERROR" so they match the filter
    // pattern. Surfacing them as errors crowded out and masked real errors
    // (8 days of data-loss `unhandled_error` events stayed invisible — #195).
    const lines = [
      '2026-05-17T21:48:43.266Z\tundefined\tERROR\t(node:2) Warning: NodeVersionSupportWarning: The AWS SDK for JavaScript (v3) will no longer support Node.js 18',
      '2026-05-17T21:48:43.000Z\tundefined\tERROR\t(node:11) DeprecationWarning: some API is deprecated',
      '2026-05-17T21:48:43.000Z\tundefined\tERROR\t(node:8) ExperimentalWarning: blah',
    ];
    for (const message of lines) {
      const event = { eventId: 'w', timestamp: Date.now(), logStreamName: 's', message };
      assert.equal(normalizeEvent(event, 'g'), null, `should drop: ${message}`);
    }
  });

  it('still surfaces a real structured error that mentions the word "warning"', () => {
    // The process-warning filter must not eat genuine errors.
    const event = {
      eventId: 'e1', timestamp: Date.parse('2026-05-18T00:05:00Z'), logStreamName: 's',
      message: '2026-05-18T00:05:00.000Z\treq\tERROR\t{"logId":"log_x","level":"error","code":"unhandled_error","path":"/v1/sync/messages%3Awp","method":"PUT","error":"Item size has exceeded the maximum allowed size"}',
    };
    const n = normalizeEvent(event, 'g');
    assert.equal(n.code, 'unhandled_error');
    assert.equal(n.meta.method, 'PUT');
  });
});

describe('isProcessWarning', () => {
  it('matches Node process warnings, not application messages', () => {
    assert.equal(isProcessWarning('(node:2) Warning: NodeVersionSupportWarning: ...'), true);
    assert.equal(isProcessWarning('(node:99) DeprecationWarning: x'), true);
    assert.equal(isProcessWarning('ERROR something failed'), false);
    assert.equal(isProcessWarning('Item size has exceeded the maximum allowed size'), false);
    assert.equal(isProcessWarning(undefined), false);
  });
});

describe('belongsToStage', () => {
  let origStage;
  beforeEach(() => { origStage = process.env.STAGE; });
  afterEach(() => { if (origStage !== undefined) process.env.STAGE = origStage; else delete process.env.STAGE; });

  it('prod excludes playground groups (the prod prefix is also a playground prefix)', () => {
    process.env.STAGE = 'prod';
    assert.equal(belongsToStage('/aws/lambda/plato-PlatoStreamFunction-abc'), true);
    assert.equal(belongsToStage('/aws/lambda/plato-PlatoApiFunction-abc'), true);
    assert.equal(belongsToStage('/aws/lambda/plato-playground-PlatoStreamFunction-abc'), false);
  });

  it('non-prod stages keep their own groups', () => {
    process.env.STAGE = 'playground';
    assert.equal(belongsToStage('/aws/lambda/plato-playground-PlatoStreamFunction-abc'), true);
  });
});

describe('filterAllPages', () => {
  // A minimal stand-in for FilterLogEventsCommand — just carries the input.
  const FakeCmd = function (input) { this.input = input; };

  it('follows nextToken across pages and concatenates all events', async () => {
    const pages = [
      { events: [{ eventId: 'a' }], nextToken: 't1' },
      { events: [{ eventId: 'b' }, { eventId: 'c' }], nextToken: 't2' },
      { events: [{ eventId: 'd' }] }, // no nextToken → stop
    ];
    let calls = 0;
    const tokensSeen = [];
    const client = {
      async send(cmd) { tokensSeen.push(cmd.input.nextToken); return pages[calls++]; },
    };
    const events = await filterAllPages(client, FakeCmd, { logGroupName: 'g', filterPattern: 'ERROR', startTime: 0 });
    assert.deepEqual(events.map((e) => e.eventId), ['a', 'b', 'c', 'd']);
    assert.equal(calls, 3, 'should have followed nextToken to the last page');
    assert.deepEqual(tokensSeen, [undefined, 't1', 't2']);
  });

  it('stops after a single page when no nextToken is returned', async () => {
    let calls = 0;
    const client = { async send() { calls++; return { events: [{ eventId: 'only' }] }; } };
    const events = await filterAllPages(client, FakeCmd, { logGroupName: 'g', filterPattern: 'ERROR', startTime: 0 });
    assert.equal(events.length, 1);
    assert.equal(calls, 1);
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
