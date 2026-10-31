/**
 * Admin → Users combined filters (#362, src/lib/userFilters.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFacets, matchesFilters, activeFilterCount, describeFilters } from '../src/lib/userFilters.js';

const FIELDS = [
  { id: 'fld_org', label: 'Org', type: 'dropdown', options: ['UIC', 'MIT'] },
  { id: 'fld_bio', label: 'Bio', type: 'text' },
];
const items = [
  { _type: 'user', email: 'a', role: 'learner', userGroup: 'A', customFields: { fld_org: 'UIC', fld_bio: 'hi' } },
  { _type: 'user', email: 'b', role: 'user', userGroup: 'B', customFields: { fld_org: 'MIT' } }, // legacy role
  { _type: 'user', email: 'c', role: 'admin', userGroup: null, customFields: {} },
  { _type: 'invite', email: 'd' },
  { _type: 'waitlist', email: 'e', userGroup: 'A', customFields: { fld_org: 'UIC' } },
];
const facets = buildFacets({ items, groups: ['A', 'B'], userFields: FIELDS });
const pick = (filters) => items.filter((i) => matchesFilters(i, filters, facets)).map((i) => i.email);

describe('user filters', () => {
  it('offers status, role, group, and each field, with counts', () => {
    assert.deepEqual(facets.map((f) => f.key), ['status', 'role', 'group', 'field:fld_org', 'field:fld_bio']);
    const count = (key, value) => facets.find((f) => f.key === key).options.find((o) => o.value === value).count;
    assert.equal(count('status', 'active'), 3);
    assert.equal(count('role', 'learner'), 2, 'legacy "user" counts as learner');
    assert.equal(count('group', '__none'), 2, 'no group: the admin and the invite');
    assert.equal(count('field:fld_org', 'UIC'), 2);
    assert.equal(count('field:fld_bio', '__empty'), 3, 'invites have no answers, so they are neither');
  });
  it('OR within a facet, AND across facets', () => {
    assert.deepEqual(pick({ group: ['A', 'B'] }), ['a', 'b', 'e']);
    assert.deepEqual(pick({ status: ['active'], group: ['A'] }), ['a']);
    assert.deepEqual(pick({ role: ['learner'], 'field:fld_org': ['MIT'] }), ['b']);
    assert.deepEqual(pick({ status: ['invited', 'waitlist'] }), ['d', 'e']);
  });
  it('a role filter leaves out invites and wait-list entries; no filter keeps everyone', () => {
    assert.deepEqual(pick({ role: ['admin'] }), ['c']);
    assert.deepEqual(pick({}), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(pick({ group: [] }), ['a', 'b', 'c', 'd', 'e']);
  });
  it('counts and describes active filters', () => {
    const f = { status: ['active'], 'field:fld_org': ['UIC', 'MIT'] };
    assert.equal(activeFilterCount(f), 3);
    assert.deepEqual(describeFilters(f, facets), [
      { key: 'status', label: 'Status', values: ['Signed up'] },
      { key: 'field:fld_org', label: 'Org', values: ['UIC', 'MIT'] },
    ]);
  });
});
