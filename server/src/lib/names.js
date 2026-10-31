/**
 * First and last names (#402). The user record stores `firstName` and
 * `lastName`, plus `name`, which is always derived (`firstName lastName`) and
 * kept for plugins, the audit log, emails, and Beta-RC-232 rollback.
 * `nameSource` is 'user' when a person or admin entered the parts, and 'auto'
 * when they were inferred from an old single `name` (m005_name_split, or on
 * read for records the migration hasn't reached). The UI hints that an 'auto'
 * split may need a correction.
 *
 * Inference splits at the first whitespace: "Mary Ann Evans" becomes "Mary" /
 * "Ann Evans". Nothing is discarded. A one-word name is a first name with no
 * last name. A last name is optional everywhere (people with one name exist).
 */

export const MAX_NAME_PART = 100;

const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export function joinName(firstName, lastName) {
  return [clean(firstName), clean(lastName)].filter(Boolean).join(' ');
}

/** `{ firstName, lastName, parts }` from a single full name. */
export function splitName(full) {
  const s = clean(full);
  if (!s) return { firstName: '', lastName: '', parts: 0 };
  const i = s.indexOf(' ');
  if (i < 0) return { firstName: s, lastName: '', parts: 1 };
  return { firstName: s.slice(0, i), lastName: s.slice(i + 1), parts: s.split(' ').length };
}

/**
 * The name fields for an API response. Records without `firstName` (written
 * before #402) are split on the fly and reported as 'auto'.
 */
export function nameFields(record) {
  if (!record) return { name: '', firstName: '', lastName: '', nameSource: 'auto' };
  // New code always keeps `name` equal to the joined parts. If they differ,
  // an older release (a rollback to Beta-RC-232) changed `name` alone, so the
  // parts are stale: split the current name instead.
  const stale = typeof record.firstName === 'string' && typeof record.name === 'string'
    && clean(record.name) && joinName(record.firstName, record.lastName) !== clean(record.name);
  if (typeof record.firstName === 'string' && !stale) {
    return {
      name: joinName(record.firstName, record.lastName),
      firstName: record.firstName,
      lastName: record.lastName || '',
      nameSource: record.nameSource || 'user',
    };
  }
  const { firstName, lastName } = splitName(record.name);
  return { name: clean(record.name), firstName, lastName, nameSource: 'auto' };
}

/**
 * Read a name from a request body. `firstName`/`lastName` win; a lone `name`
 * (older clients, the public wait-list API) is split. Parts the body leaves
 * out keep their `current` value, so `{ lastName }` alone changes only the
 * last name.
 *
 * Returns `{ fields }` with `{ firstName, lastName, name, nameSource }` ready
 * to store (`nameSource` is 'auto' when split from a lone `name`), `{ fields: null }` when the body has no name at all, or
 * `{ error }`.
 */
export function readNameInput(body, { current = null, required = false } = {}) {
  const has = (k) => body && body[k] !== undefined && body[k] !== null;
  for (const k of ['firstName', 'lastName', 'name']) {
    if (has(k) && typeof body[k] !== 'string') return { error: `${k} must be text` };
  }
  let firstName;
  let lastName;
  let nameSource = 'user';
  if (has('firstName') || has('lastName')) {
    const cur = nameFields(current);
    firstName = has('firstName') ? clean(body.firstName) : cur.firstName;
    lastName = has('lastName') ? clean(body.lastName) : cur.lastName;
  } else if (has('name')) {
    ({ firstName, lastName } = splitName(body.name));
    nameSource = 'auto';
  } else {
    return required ? { error: 'First name is required' } : { fields: null };
  }
  if (!firstName) return { error: 'First name is required' };
  if (firstName.length > MAX_NAME_PART || lastName.length > MAX_NAME_PART) {
    return { error: `First and last name must each be at most ${MAX_NAME_PART} characters` };
  }
  return { fields: { firstName, lastName, name: joinName(firstName, lastName), nameSource } };
}
