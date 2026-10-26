// CSV export for Admin → Users (#382). Pure functions so they're unit-tested
// (client/tests/csv.test.js); the component only triggers the download.

// Cells starting with these are run as formulas by Excel/Sheets/LibreOffice.
// Names and custom-field answers come from the public wait-list form, so a
// value like `=HYPERLINK(...)` is attacker-controlled. OWASP's mitigation:
// prefix a single quote so the cell is read as text.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value == null) return '';
  let str = String(value);
  if (FORMULA_START.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows) {
  // CRLF line endings (RFC 4180), which Excel expects.
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

const TYPE_LABELS = { user: 'User', invite: 'Invited', waitlist: 'Wait List' };

/**
 * Rows for the Admin → Users list as shown (current filter, search, sort).
 * `items` are AdminUsers' combinedList wrappers; one column per custom field,
 * in field order. Dates are ISO (YYYY-MM-DD), not the admin's locale format.
 */
export function usersCsvRows(items, userFields) {
  const header = ['Email', 'Name', 'Username', 'Group', 'Role', 'Status', 'Date Added', ...userFields.map((f) => f.label)];
  const rows = items.map((item) => [
    item.email,
    item.name,
    item.username,
    item.userGroup,
    item.role,
    TYPE_LABELS[item._type] || item._type,
    item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : '',
    ...userFields.map((f) => item.customFields?.[f.id] ?? ''),
  ]);
  return [header, ...rows];
}
