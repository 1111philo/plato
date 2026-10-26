/**
 * CSV export for Admin → Users (#382): escaping, spreadsheet formula
 * injection (wait-list answers are public input), and the row shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, usersCsvRows } from '../src/lib/csv.js';

describe('csvCell', () => {
  it('passes plain values through and blanks nullish ones', () => {
    assert.equal(csvCell('Ada'), 'Ada');
    assert.equal(csvCell(42), '42');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  it('quotes commas, quotes, and line breaks', () => {
    assert.equal(csvCell('Lovelace, Ada'), '"Lovelace, Ada"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('a\nb'), '"a\nb"');
    assert.equal(csvCell('a\r\nb'), '"a\r\nb"');
  });

  it('neutralizes formula injection', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
    assert.equal(csvCell('+1 312 555 0100'), "'+1 312 555 0100");
    assert.equal(csvCell('-2'), "'-2");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvCell('\t=1'), "'\t=1");
    assert.equal(csvCell('a=b'), 'a=b', 'only a leading trigger matters');
  });
});

describe('toCsv', () => {
  it('joins cells and rows with CRLF', () => {
    assert.equal(toCsv([['a', 'b,c'], ['1', '2']]), 'a,"b,c"\r\n1,2');
  });
});

describe('usersCsvRows', () => {
  const fields = [{ id: 'fld_org', label: 'Org, Name' }, { id: 'fld_ph', label: 'Phone' }];
  const items = [
    { _type: 'user', email: 'a@x.com', name: 'A', username: 'a', userGroup: 'G', role: 'admin', createdAt: '2026-10-01T23:30:00Z', customFields: { fld_org: 'UIC' } },
    { _type: 'waitlist', email: 'w@x.com', name: 'W', username: null, userGroup: null, role: null, createdAt: '2026-10-02T01:00:00Z', customFields: { fld_ph: '+1 555 0100' } },
    { _type: 'invite', email: 'i@x.com', name: null, username: null, userGroup: null, role: null, createdAt: '2026-10-03T00:00:00Z', customFields: null },
  ];

  it('has one column per custom field, in order', () => {
    const [header] = usersCsvRows(items, fields);
    assert.deepEqual(header, ['Email', 'Name', 'Username', 'Group', 'Role', 'Status', 'Date Added', 'Org, Name', 'Phone']);
  });

  it('maps statuses, ISO dates, and blanks missing values', () => {
    const [, user, wl, inv] = usersCsvRows(items, fields);
    assert.deepEqual(user, ['a@x.com', 'A', 'a', 'G', 'admin', 'User', '2026-10-01', 'UIC', '']);
    assert.deepEqual(wl.slice(5), ['Wait List', '2026-10-02', '', '+1 555 0100']);
    assert.deepEqual(inv.slice(5), ['Invited', '2026-10-03', '', '']);
  });

  it('round-trips through toCsv with labels escaped', () => {
    const csv = toCsv(usersCsvRows(items, fields));
    assert.ok(csv.startsWith('Email,Name,Username,Group,Role,Status,Date Added,"Org, Name",Phone\r\n'));
    assert.ok(csv.includes(",'+1 555 0100"));
  });
});
