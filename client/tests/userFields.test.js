/**
 * Tests for the client-side custom user field helpers (#364): the
 * required-field mirror that drives ProfileCompletionGate, and the
 * Admin → Users search/filter predicates.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  missingRequired, pickValues, customFieldsMatch, matchesFieldFilter, fieldTypeLabel,
} from '../src/lib/userFields.js';

const ORG = { id: 'fld_org', label: 'Organization', type: 'text', required: true };
const ROLE = { id: 'fld_role', label: 'Role', type: 'dropdown', required: true, options: ['Teacher', 'Student'] };
const BIO = { id: 'fld_bio', label: 'Bio', type: 'textarea', required: false };
const DEFS = [ORG, ROLE, BIO];

describe('missingRequired', () => {
  it('lists required fields with no value', () => {
    assert.deepEqual(missingRequired(DEFS, {}), ['fld_org', 'fld_role']);
    assert.deepEqual(missingRequired(DEFS, undefined), ['fld_org', 'fld_role']);
  });
  it('treats whitespace and stale dropdown options as missing', () => {
    assert.deepEqual(missingRequired(DEFS, { fld_org: '  ', fld_role: 'Gone' }), ['fld_org', 'fld_role']);
  });
  it('is empty when all required fields are filled', () => {
    assert.deepEqual(missingRequired(DEFS, { fld_org: 'UIC', fld_role: 'Teacher' }), []);
  });
});

describe('pickValues', () => {
  it('returns the listed ids, blank-filling absent ones', () => {
    assert.deepEqual(pickValues({ fld_org: 'UIC', fld_bio: 'x' }, ['fld_org', 'fld_role']), { fld_org: 'UIC', fld_role: '' });
  });
});

describe('customFieldsMatch', () => {
  it('matches substrings case-insensitively', () => {
    assert.equal(customFieldsMatch({ fld_org: 'University of Illinois' }, 'illinois'), true);
    assert.equal(customFieldsMatch({ fld_org: 'UIC' }, 'mit'), false);
    assert.equal(customFieldsMatch(undefined, 'x'), false);
  });
});

describe('matchesFieldFilter', () => {
  it('passes everything with no filter', () => {
    assert.equal(matchesFieldFilter({}, ORG, ''), true);
    assert.equal(matchesFieldFilter({}, null, 'x'), true);
  });
  it('matches dropdowns exactly', () => {
    assert.equal(matchesFieldFilter({ fld_role: 'Teacher' }, ROLE, 'Teacher'), true);
    assert.equal(matchesFieldFilter({ fld_role: 'Teacher' }, ROLE, 'Teach'), false);
  });
  it('matches text by substring', () => {
    assert.equal(matchesFieldFilter({ fld_org: 'UIC Chicago' }, ORG, 'chicago'), true);
    assert.equal(matchesFieldFilter({}, ORG, 'chicago'), false);
  });
  it('supports has-value / empty filters', () => {
    assert.equal(matchesFieldFilter({ fld_org: 'UIC' }, ORG, '__set'), true);
    assert.equal(matchesFieldFilter({}, ORG, '__set'), false);
    assert.equal(matchesFieldFilter({}, ORG, '__empty'), true);
    assert.equal(matchesFieldFilter({ fld_org: 'UIC' }, ORG, '__empty'), false);
  });
});

describe('fieldTypeLabel', () => {
  it('labels known types and passes unknown through', () => {
    assert.equal(fieldTypeLabel('textarea'), 'Text area');
    assert.equal(fieldTypeLabel('weird'), 'weird');
  });
});
