// Client helpers for admin-defined custom user fields (#364). Validation is
// owned by the server (server/src/lib/user-fields.js); these helpers only
// drive form state, the ProfileCompletionGate, and Admin → Users search/filter.

export const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'link', label: 'Link' },
  { value: 'phone', label: 'Phone' },
];

export function fieldTypeLabel(type) {
  return FIELD_TYPE_OPTIONS.find((t) => t.value === type)?.label || type;
}

/**
 * Who can see and fill in a field: one choice in the admin UI, stored as the
 * server's two flags (lib/user-fields.js). Admins always see every field.
 */
export const FIELD_VISIBILITY = [
  { value: 'everyone', label: 'Everyone', summary: 'Everyone', hint: 'Signup, the wait-list form and API, and the learner’s profile.' },
  { value: 'learners', label: 'Learners, after signup', summary: 'After signup', hint: 'In the learner’s profile only. Not on signup, the wait-list form, or the API.' },
  { value: 'admins', label: 'Admins only', summary: 'Admins only', hint: 'Learners never see it. Only admins fill it in.' },
];

export function fieldVisibility(field) {
  if (field?.hideFromLearner) return 'admins';
  if (field?.hideFromApi) return 'learners';
  return 'everyone';
}

export function visibilityFlags(visibility) {
  return { hideFromLearner: visibility === 'admins', hideFromApi: visibility !== 'everyone' };
}

/** "Dropdown · Required · Everyone": a field's settings in one line. */
export function fieldSummary(field) {
  const vis = FIELD_VISIBILITY.find((v) => v.value === fieldVisibility(field));
  return [fieldTypeLabel(field.type), field.required && !field.hideFromLearner ? 'Required' : null, vis.summary].filter(Boolean).join(' · ');
}

/** Mirror of the server's missingRequiredFields — used to disable Save until filled. */
export function missingRequired(defs, values) {
  const v = values || {};
  return (defs || [])
    .filter((d) => d.required)
    .filter((d) => {
      const val = typeof v[d.id] === 'string' ? v[d.id].trim() : '';
      if (!val) return true;
      if (d.type === 'dropdown' && !(d.options || []).includes(val)) return true;
      return false;
    })
    .map((d) => d.id);
}

/** Only the values for the given field ids — what a partial PATCH should send. */
export function pickValues(values, ids) {
  const out = {};
  for (const id of ids) out[id] = values?.[id] ?? '';
  return out;
}

/** True when any custom field value contains the (lowercased) query. */
export function customFieldsMatch(customFields, q) {
  if (!customFields || !q) return false;
  return Object.values(customFields).some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

/**
 * Admin → Users field filter. `value` is matched exactly for dropdowns and as
 * a case-insensitive substring otherwise; the special values `__set` /
 * `__empty` filter on presence.
 */
export function matchesFieldFilter(customFields, def, value) {
  if (!def || !value) return true;
  const v = customFields?.[def.id];
  const has = typeof v === 'string' && v.trim() !== '';
  if (value === '__set') return has;
  if (value === '__empty') return !has;
  if (!has) return false;
  if (def.type === 'dropdown') return v === value;
  return v.toLowerCase().includes(value.trim().toLowerCase());
}
