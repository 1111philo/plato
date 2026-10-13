// Admin-defined custom user fields (#364).
//
// Definitions live in `_system:settings.userFields` (ordered array, alongside
// `userGroups`). Values live on the user record as `customFields`, an object
// keyed by field id — on the record (not sync-data) so the Admin → Users list
// can search/filter across every user without N extra reads.
//
// This module is the single place that validates definitions and values; the
// routes (me.js, admin.js, auth.js) only call into it.

import { randomBytes } from 'node:crypto';

export const FIELD_TYPES = ['text', 'textarea', 'dropdown', 'link', 'phone'];

export const MAX_FIELDS = 30;
export const MAX_LABEL_LENGTH = 80;
export const MAX_OPTIONS = 50;
export const MAX_OPTION_LENGTH = 100;
const MAX_VALUE_LENGTH = { text: 200, textarea: 2000, dropdown: MAX_OPTION_LENGTH, link: 2000, phone: 30 };

export function generateFieldId() {
  return 'fld_' + randomBytes(6).toString('hex');
}

/** Read the ordered field definitions from the `_system:settings` record data. */
export function getFieldDefinitions(settingsData) {
  const list = settingsData?.userFields;
  return Array.isArray(list) ? list : [];
}

/**
 * Validate an admin-supplied definition. Returns `{ field }` (normalized) or
 * `{ error }`. `id` is preserved from `existing` on update; generated on create.
 */
export function validateFieldDefinition(input, existing = null) {
  if (!input || typeof input !== 'object') return { error: 'Field definition is required' };
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label) return { error: 'Field label is required' };
  if (label.length > MAX_LABEL_LENGTH) return { error: `Field label must be ${MAX_LABEL_LENGTH} characters or fewer` };
  const type = input.type ?? existing?.type;
  if (!FIELD_TYPES.includes(type)) return { error: `Field type must be one of: ${FIELD_TYPES.join(', ')}` };

  const field = { id: existing?.id || generateFieldId(), label, type, required: !!input.required };

  if (type === 'dropdown') {
    const raw = Array.isArray(input.options) ? input.options : [];
    const options = [];
    for (const o of raw) {
      const opt = typeof o === 'string' ? o.trim() : '';
      if (!opt || options.includes(opt)) continue;
      if (opt.length > MAX_OPTION_LENGTH) return { error: `Options must be ${MAX_OPTION_LENGTH} characters or fewer` };
      options.push(opt);
    }
    if (options.length === 0) return { error: 'Dropdown fields need at least one option' };
    if (options.length > MAX_OPTIONS) return { error: `Dropdown fields can have at most ${MAX_OPTIONS} options` };
    field.options = options;
  }
  return { field };
}

const PHONE_RE = /^\+?[0-9 ().-]+$/;

/** Validate one value against its definition. Returns an error string or null. Empty is valid here (required is checked separately). */
export function validateValue(def, value) {
  if (value.length > MAX_VALUE_LENGTH[def.type]) {
    return `${def.label} must be ${MAX_VALUE_LENGTH[def.type]} characters or fewer`;
  }
  if (def.type === 'dropdown' && !def.options.includes(value)) {
    return `${def.label} must be one of the listed options`;
  }
  if (def.type === 'link') {
    let url;
    try { url = new URL(value); } catch { /* fallthrough */ }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      return `${def.label} must be a valid http(s) link`;
    }
  }
  if (def.type === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_RE.test(value) || digits < 7 || digits > 15) {
      return `${def.label} must be a valid phone number`;
    }
  }
  return null;
}

/**
 * Merge an incoming `{ [fieldId]: value }` patch onto `current` values.
 * Unknown ids are ignored; empty strings / null clear a value. When
 * `enforceRequired` is set (learner self-edits AND admin edits), the merged
 * result must have every required field filled. Signup doesn't set it — a
 * stale cached signup form must not hard-fail; the gate collects the rest.
 *
 * Returns `{ values }` (the full merged object, pruned of ids that no longer
 * have a definition) or `{ error }`.
 */
export function mergeFieldValues(defs, current, patch, { enforceRequired = false } = {}) {
  if (patch == null) patch = {};
  if (typeof patch !== 'object' || Array.isArray(patch)) return { error: 'customFields must be an object' };
  const byId = new Map(defs.map((d) => [d.id, d]));
  const values = {};
  for (const [id, v] of Object.entries(current || {})) {
    if (byId.has(id)) values[id] = v;
  }
  for (const [id, raw] of Object.entries(patch)) {
    const def = byId.get(id);
    if (!def) continue;
    const value = raw == null ? '' : typeof raw === 'string' ? raw.trim() : null;
    if (value === null) return { error: `${def.label} must be a string` };
    if (value === '') {
      delete values[id];
      continue;
    }
    const err = validateValue(def, value);
    if (err) return { error: err };
    values[id] = value;
  }
  if (enforceRequired) {
    const missing = missingRequiredFields(defs, values);
    if (missing.length) return { error: requiredError(defs, missing) };
  }
  return { values };
}

function requiredError(defs, missing) {
  const labels = defs.filter((d) => missing.includes(d.id)).map((d) => d.label);
  return labels.length === 1 ? `${labels[0]} is required` : `Required: ${labels.join(', ')}`;
}

/**
 * Ids of required fields that have no valid value. A dropdown value that's no
 * longer among the options counts as missing, so learners re-pick after an
 * admin edits the option list.
 */
export function missingRequiredFields(defs, values) {
  const v = values || {};
  return defs
    .filter((d) => d.required)
    .filter((d) => {
      const val = v[d.id];
      if (typeof val !== 'string' || !val.trim()) return true;
      if (d.type === 'dropdown' && !d.options.includes(val)) return true;
      return false;
    })
    .map((d) => d.id);
}

/** Only the values that still have a definition — what API responses expose. */
export function visibleFieldValues(defs, values) {
  const out = {};
  if (!values || typeof values !== 'object') return out;
  for (const d of defs) {
    if (typeof values[d.id] === 'string') out[d.id] = values[d.id];
  }
  return out;
}
