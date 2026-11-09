/**
 * SES account-level suppression list (src/lib/email-suppression.js).
 * A fake SESv2 client stands in for SES.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const s = await import('../../src/lib/email-suppression.js');
const { logger } = await import('../../src/lib/logger.js');

function fakeSes(handler) {
  const calls = [];
  return { calls, async send(cmd) { calls.push({ name: cmd.constructor.name, input: cmd.input }); return handler(cmd.constructor.name, cmd.input); } };
}
const notFound = () => Object.assign(new Error('not on list'), { name: 'NotFoundException', $metadata: { httpStatusCode: 404 } });

beforeEach(() => {
  s._resetSuppression();
  logger._reset();
  delete process.env.SUPPRESSED_EMAILS;
  delete process.env.SKIP_EMAIL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});
afterEach(() => { s._resetSuppression(); delete process.env.SUPPRESSED_EMAILS; delete process.env.AWS_LAMBDA_FUNCTION_NAME; });

describe('getSuppression (SES)', () => {
  it('returns the reason and date for a suppressed address, normalized, and caches it', async () => {
    const ses = fakeSes(() => ({ SuppressedDestination: { EmailAddress: 'ada@x.com', Reason: 'COMPLAINT', LastUpdateTime: new Date('2026-03-22T10:00:00Z') } }));
    s._setSesClient(ses);
    assert.deepEqual(await s.getSuppression(' Ada@X.com '), { reason: 'COMPLAINT', since: '2026-03-22T10:00:00.000Z' });
    assert.deepEqual(await s.getSuppression('ada@x.com'), { reason: 'COMPLAINT', since: '2026-03-22T10:00:00.000Z' });
    assert.equal(ses.calls.length, 1, 'second lookup is cached');
    assert.deepEqual(ses.calls[0], { name: 'GetSuppressedDestinationCommand', input: { EmailAddress: 'ada@x.com' } });
  });

  it('NotFoundException means not suppressed (cached too)', async () => {
    const ses = fakeSes(() => { throw notFound(); });
    s._setSesClient(ses);
    assert.equal(await s.getSuppression('ok@x.com'), null);
    assert.equal(await s.getSuppression('ok@x.com'), null);
    assert.equal(ses.calls.length, 1);
    assert.equal(logger.recent().length, 0, 'not found is not an error');
  });

  it('fails open on any other error and warns once', async () => {
    const ses = fakeSes(() => { throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' }); });
    s._setSesClient(ses);
    assert.equal(await s.getSuppression('a@x.com'), null);
    assert.equal(await s.getSuppression('b@x.com'), null);
    const warns = logger.recent().filter((e) => e.code === 'email_suppression_check_failed');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].meta.error, 'AccessDeniedException');
    assert.ok(!JSON.stringify(warns[0]).includes('a@x.com'), 'no address in the log');
  });

  it('removeSuppression deletes from SES and clears the cache', async () => {
    let listed = true;
    const ses = fakeSes((name) => {
      if (name === 'DeleteSuppressedDestinationCommand') { listed = false; return {}; }
      if (!listed) throw notFound();
      return { SuppressedDestination: { Reason: 'BOUNCE', LastUpdateTime: new Date('2026-01-01') } };
    });
    s._setSesClient(ses);
    assert.equal((await s.getSuppression('a@x.com')).reason, 'BOUNCE');
    await s.removeSuppression('A@x.com');
    assert.equal(await s.getSuppression('a@x.com'), null);
    assert.deepEqual(ses.calls.find((c) => c.name === 'DeleteSuppressedDestinationCommand').input, { EmailAddress: 'a@x.com' });
  });
});

describe('listSuppressed (SES)', () => {
  it('pages through the whole list and caches it', async () => {
    const ses = fakeSes((name, input) => (input.NextToken
      ? { SuppressedDestinationSummaries: [{ EmailAddress: 'B@x.com', Reason: 'COMPLAINT', LastUpdateTime: new Date('2026-02-01') }] }
      : { SuppressedDestinationSummaries: [{ EmailAddress: 'a@x.com', Reason: 'BOUNCE', LastUpdateTime: new Date('2026-01-01') }], NextToken: 't1' }));
    s._setSesClient(ses);
    const list = await s.listSuppressed();
    assert.deepEqual(list.map((e) => [e.email, e.reason]), [['a@x.com', 'BOUNCE'], ['b@x.com', 'COMPLAINT']]);
    await s.listSuppressed();
    assert.equal(ses.calls.length, 2, 'two pages, then cached');
  });
  it('returns null on error (no badges), never throws', async () => {
    s._setSesClient(fakeSes(() => { throw new Error('boom'); }));
    assert.equal(await s.listSuppressed(), null);
  });
});

describe('SUPPRESSED_EMAILS (dev / e2e)', () => {
  it('parses addresses with optional reasons', () => {
    assert.deepEqual(s.parseSuppressedEnv(' a@x.com , B@y.com:complaint, junk, c@z.com:BOUNCE '), [
      { email: 'a@x.com', reason: 'BOUNCE', since: null },
      { email: 'b@y.com', reason: 'COMPLAINT', since: null },
      { email: 'c@z.com', reason: 'BOUNCE', since: null },
    ]);
  });
  it('is the list off Lambda, and removal works in-process', async () => {
    process.env.SUPPRESSED_EMAILS = 'bounced@example.com:BOUNCE';
    assert.deepEqual(await s.getSuppression('Bounced@example.com'), { reason: 'BOUNCE', since: null });
    assert.equal(await s.getSuppression('fine@example.com'), null);
    assert.equal((await s.listSuppressed()).length, 1);
    await s.removeSuppression('bounced@example.com');
    assert.equal(await s.getSuppression('bounced@example.com'), null);
  });
  it('is ignored on Lambda', async () => {
    process.env.SUPPRESSED_EMAILS = 'bounced@example.com';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'plato-api';
    const ses = fakeSes(() => { throw notFound(); });
    s._setSesClient(ses);
    assert.equal(await s.getSuppression('bounced@example.com'), null);
    assert.equal(ses.calls.length, 1, 'asked SES instead');
  });
});
