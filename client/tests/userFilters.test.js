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

describe('Slack filter', () => {
  const list = [
    { _type: 'user', email: 'a', _user: { slackUserId: 'U1' } },
    { _type: 'user', email: 'b', _user: {} },
    { _type: 'invite', email: 'c' },
    { _type: 'waitlist', email: 'd' },
  ];
  it('is offered only when Slack is connected', () => {
    assert.equal(buildFacets({ items: list }).some((f) => f.key === 'slack'), false);
    assert.equal(buildFacets({ items: list, slack: true }).some((f) => f.key === 'slack'), true);
  });
  it('splits signed-up users into Linked and Not linked; invites and the wait list match neither', () => {
    const f = buildFacets({ items: list, slack: true });
    const slack = f.find((x) => x.key === 'slack');
    assert.deepEqual(slack.options.map((o) => [o.label, o.count]), [['Linked', 1], ['Not linked', 1]]);
    const pickS = (v) => list.filter((i) => matchesFilters(i, { slack: v }, f)).map((i) => i.email);
    assert.deepEqual(pickS(['linked']), ['a']);
    assert.deepEqual(pickS(['unlinked']), ['b']);
    assert.deepEqual(describeFilters({ slack: ['unlinked'] }, f), [{ key: 'slack', label: 'Slack', values: ['Not linked'] }]);
  });
});

describe('Sign-in filter (single sign-on)', () => {
  const list = [
    { _type: 'user', email: 'a', _user: { hasPassword: true, sso: null } },
    { _type: 'user', email: 'b', _user: { hasPassword: false, sso: { provider: 'entra' } } },
    { _type: 'user', email: 'c', _user: { hasPassword: true, sso: { provider: 'entra' } } },
    { _type: 'invite', email: 'd' },
    { _type: 'waitlist', email: 'e', _entry: { ssoVerified: 'entra' } },
    { _type: 'waitlist', email: 'f', _entry: { ssoVerified: null } },
  ];
  it('is offered only when single sign-on is in play, and leaves Status alone otherwise', () => {
    const off = buildFacets({ items: list });
    assert.equal(off.some((f) => f.key === 'signin'), false);
    assert.deepEqual(off.find((f) => f.key === 'status').options.map((o) => o.value), ['active', 'invited', 'expired', 'waitlist']);
    assert.equal(buildFacets({ items: list, sso: true }).some((f) => f.key === 'signin'), true);
  });
  it('counts Password and SSO over signed-up users; someone with both matches both', () => {
    const f = buildFacets({ items: list, sso: true });
    const signin = f.find((x) => x.key === 'signin');
    assert.deepEqual(signin.options.map((o) => [o.label, o.count]), [['Password', 2], ['SSO', 2]]);
    const pickS = (v) => list.filter((i) => matchesFilters(i, { signin: v }, f)).map((i) => i.email);
    assert.deepEqual(pickS(['password']), ['a', 'c']);
    assert.deepEqual(pickS(['sso']), ['b', 'c']);
    assert.deepEqual(pickS(['password', 'sso']), ['a', 'b', 'c'], 'invites and the wait list match neither');
    assert.deepEqual(describeFilters({ signin: ['sso'] }, f), [{ key: 'signin', label: 'Sign-in', values: ['SSO'] }]);
  });
  it('a user row without hasPassword counts as a password account', () => {
    const rows = [{ _type: 'user', email: 'x', _user: {} }];
    const f = buildFacets({ items: rows, sso: true });
    assert.deepEqual(rows.filter((i) => matchesFilters(i, { signin: ['password'] }, f)).map((i) => i.email), ['x']);
  });
  it('Status offers Wait list: verified; a verified entry is still on the wait list', () => {
    const f = buildFacets({ items: list, sso: true });
    const status = f.find((x) => x.key === 'status');
    const count = (v) => status.options.find((o) => o.value === v).count;
    assert.equal(count('waitlist'), 2);
    assert.equal(count('verified'), 1);
    const pickS = (v) => list.filter((i) => matchesFilters(i, { status: v }, f)).map((i) => i.email);
    assert.deepEqual(pickS(['verified']), ['e']);
    assert.deepEqual(pickS(['waitlist']), ['e', 'f']);
  });
});

describe('invites from the wait list', () => {
  const wlItems = [
    { _type: 'invite', email: 'p', _invite: {} },
    { _type: 'invite', email: 'q', userGroup: 'A', customFields: { fld_org: 'UIC' }, _invite: {} },
    { _type: 'user', email: 'r', role: 'learner', userGroup: 'A', customFields: { fld_org: 'MIT' } },
  ];
  const wlFacets = buildFacets({ items: wlItems, groups: ['A'], userFields: FIELDS });
  const wlPick = (filters) => wlItems.filter((i) => matchesFilters(i, filters, wlFacets)).map((i) => i.email);

  it('keep their group and answers for filtering; a plain invite still has neither', () => {
    assert.deepEqual(wlPick({ group: ['A'] }), ['q', 'r']);
    assert.deepEqual(wlPick({ group: ['__none'] }), ['p']);
    assert.deepEqual(wlPick({ 'field:fld_org': ['UIC'] }), ['q']);
    assert.deepEqual(wlPick({ 'field:fld_org': ['__empty'] }), [], 'a plain invite has no answers, so it is not "empty" either');
  });
});

describe('expired invites', () => {
  const list = [
    { _type: 'invite', email: 'a', _invite: { expired: true } },
    { _type: 'invite', email: 'b', _invite: { expired: false } },
    { _type: 'user', email: 'c', _user: {} },
  ];
  it('Status splits invites into Invited and Invite expired', () => {
    const f = buildFacets({ items: list });
    const status = f.find((x) => x.key === 'status');
    const count = (v) => status.options.find((o) => o.value === v).count;
    assert.equal(count('expired'), 1);
    assert.equal(count('invited'), 1);
    assert.deepEqual(list.filter((i) => matchesFilters(i, { status: ['expired'] }, f)).map((i) => i.email), ['a']);
  });
});
