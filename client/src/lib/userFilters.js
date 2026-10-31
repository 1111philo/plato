// Admin → Users combined filters (#362). Each facet (status, role, group,
// each custom field) is a set of checked values: OR within a facet, AND
// across facets, and an empty set doesn't filter. Pure, tested in
// client/tests/userFilters.test.js. Items are AdminUsers' combinedList
// wrappers (`_type` 'user' | 'invite' | 'waitlist').
import { normalizeRole, ROLE_LABELS } from './permissions.js';
import { matchesFieldFilter } from './userFields.js';

const NO_GROUP = '__none';
const statusOf = (i) => (i._type === 'user' ? 'active' : i._type === 'invite' ? 'invited' : 'waitlist');

/** The value(s) an item has for a facet; null means "this facet doesn't apply" (it's filtered out). */
function valuesOf(item, facet) {
  if (facet.key === 'status') return [statusOf(item)];
  if (facet.key === 'role') return item._type === 'user' ? [normalizeRole(item.role)] : null;
  if (facet.key === 'group') return item._type === 'invite' ? [NO_GROUP] : [item.userGroup || NO_GROUP];
  if (facet.field) {
    if (item._type === 'invite') return null; // invites have no answers
    return facet.options.map((o) => o.value).filter((v) => matchesFieldFilter(item.customFields, facet.field, v));
  }
  return null;
}

/**
 * The facets to offer, with counts over `items`:
 * `[{ key, label, options: [{ value, label, count }] }]`. Custom fields offer
 * their dropdown options (plus Empty), or Has a value / Empty.
 */
export function buildFacets({ items, groups = [], userFields = [] }) {
  const facets = [
    { key: 'status', label: 'Status', options: [
      { value: 'active', label: 'Signed up' }, { value: 'invited', label: 'Invited' }, { value: 'waitlist', label: 'Wait list' },
    ] },
    { key: 'role', label: 'Role', options: ['admin', 'educator', 'learner', 'tester'].map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
  ];
  if (groups.length || items.some((i) => i.userGroup)) {
    const names = [...new Set([...groups, ...items.map((i) => i.userGroup).filter(Boolean)])];
    facets.push({ key: 'group', label: 'Group', options: [...names.map((g) => ({ value: g, label: g })), { value: NO_GROUP, label: 'No group' }] });
  }
  for (const f of userFields) {
    const options = f.type === 'dropdown'
      ? [...(f.options || []).map((o) => ({ value: o, label: o })), { value: '__empty', label: 'Empty' }]
      : [{ value: '__set', label: 'Has a value' }, { value: '__empty', label: 'Empty' }];
    facets.push({ key: `field:${f.id}`, label: f.label, field: f, options });
  }
  for (const facet of facets) {
    for (const o of facet.options) o.count = items.filter((i) => (valuesOf(i, facet) || []).includes(o.value)).length;
  }
  return facets;
}

/** `filters`: `{ [facetKey]: [values] }`. */
export function matchesFilters(item, filters, facets) {
  for (const facet of facets) {
    const want = filters[facet.key];
    if (!want?.length) continue;
    const have = valuesOf(item, facet);
    if (!have || !have.some((v) => want.includes(v))) return false;
  }
  return true;
}

export const activeFilterCount = (filters) => Object.values(filters).reduce((n, v) => n + (v?.length || 0), 0);

/** `[{ key, label, values: [labels] }]` for the chips under the toolbar. */
export function describeFilters(filters, facets) {
  return facets.filter((f) => filters[f.key]?.length).map((f) => ({
    key: f.key,
    label: f.label,
    values: f.options.filter((o) => filters[f.key].includes(o.value)).map((o) => o.label),
  }));
}
