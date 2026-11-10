/**
 * Admin → Users bounce / spam badges and banners (src/lib/emailSuppression.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suppressionMap, suppressionReason, notSentText, SUPPRESSION_LABEL } from '../src/lib/emailSuppression.js';

describe('emailSuppression', () => {
  it('maps the API list by lowercased email; anything else is an empty map', () => {
    assert.deepEqual(suppressionMap({ suppressed: [{ email: 'Ada@X.com', reason: 'BOUNCE', since: '2026-03-22T12:00:00Z' }] }),
      { 'ada@x.com': { reason: 'BOUNCE', since: '2026-03-22T12:00:00Z' } });
    assert.deepEqual(suppressionMap(null), {});
    assert.deepEqual(suppressionMap({ error: 'x' }), {});
  });
  it('labels both reasons', () => {
    assert.equal(SUPPRESSION_LABEL.BOUNCE, 'Email bounced');
    assert.equal(SUPPRESSION_LABEL.COMPLAINT, 'Marked as spam');
  });
  it('says what happened and when, if known', () => {
    assert.equal(notSentText('ada@x.com', { reason: 'BOUNCE', since: '2026-03-22T12:00:00Z' }), 'Not sent: ada@x.com bounced on Mar 22, 2026. Check the address.');
    assert.equal(notSentText('ada@x.com', { reason: 'BOUNCE', since: null }), 'Not sent: ada@x.com bounced. Check the address.');
    assert.equal(notSentText('bo@x.com', { reason: 'COMPLAINT' }), 'Not sent: bo@x.com marked our email as spam.');
    assert.equal(suppressionReason({ reason: 'BOUNCE', since: 'garbage' }), 'bounced');
  });
});
