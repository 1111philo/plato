/**
 * Admin → Users wording for Trace mode (#595, src/lib/traceAdmin.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { traceBulkSentence, traceBulkButton, traceBulkResult } from '../src/lib/traceAdmin.js';

describe('Trace mode bulk update wording', () => {
  it('says what turning it on or off does, with the right plural', () => {
    assert.equal(traceBulkSentence({ on: true, users: 2 }), 'Records what plato does in the lessons of 2 users. They’re told, and can read the trace too.');
    assert.equal(traceBulkSentence({ on: false, users: 1 }), 'Turns Trace mode off for 1 user. Anyone who turned it on themselves keeps it.');
  });
  it('says wait-list entries are skipped when some are selected', () => {
    assert.match(traceBulkSentence({ on: true, users: 1, waitlist: 2 }), / Wait-list entries are skipped\.$/);
    assert.doesNotMatch(traceBulkSentence({ on: true, users: 1, waitlist: 0 }), /Wait-list/);
  });
  it('labels the button with the accounts it reaches', () => {
    assert.equal(traceBulkButton({ on: true, users: 3 }), 'Turn on for 3 users');
    assert.equal(traceBulkButton({ on: false, users: 1 }), 'Turn off for 1 user');
  });
  it('reports who changed, who already had it, and failures', () => {
    assert.deepEqual(traceBulkResult({ updated: 3, unchanged: 1, failed: [] }, true), { text: 'Trace mode turned on for 3 people. 1 already had it on.', type: 'success' });
    assert.deepEqual(traceBulkResult({ updated: 1, unchanged: 0, failed: [] }, false), { text: 'Trace mode turned off for 1 person.', type: 'success' });
    assert.deepEqual(traceBulkResult({ updated: 0, unchanged: 2, failed: [{ userId: 'usr_x', error: 'User not found' }] }, false),
      { text: 'Trace mode turned off for 0 people. 2 already had it off. 1 couldn’t be updated.', type: 'error' });
    assert.equal(traceBulkResult({}, true).text, 'Trace mode turned on for 0 people.');
  });
});
