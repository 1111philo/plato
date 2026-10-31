/**
 * Admin table column layout (#385, src/lib/tableColumns.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrefs, reconcile, visibleColumns, arrangeable, toggleColumn, moveColumn, loadPrefs, savePrefs } from '../src/lib/tableColumns.js';

const COLS = [
  { id: 'name', label: 'Name', fixed: true },
  { id: 'email', label: 'Email' },
  { id: 'group', label: 'Group' },
  { id: 'userId', label: 'User ID' },
  { id: 'fld_x', label: 'Org', defaultHidden: true },
  { id: 'actions', label: 'Actions', fixed: true },
];
const ids = (cols) => cols.map((c) => c.id);

describe('table columns', () => {
  it('defaults: everything but defaultHidden, fixed ends in place', () => {
    assert.deepEqual(ids(visibleColumns(COLS, null)), ['name', 'email', 'group', 'userId', 'actions']);
    assert.deepEqual(defaultPrefs(COLS).hidden, ['fld_x']);
  });
  it('hides, shows, and reorders; fixed columns never move or hide', () => {
    let p = toggleColumn(COLS, null, 'email', false);
    p = toggleColumn(COLS, p, 'fld_x', true);
    p = moveColumn(COLS, p, 'userId', -1);
    assert.deepEqual(ids(visibleColumns(COLS, p)), ['name', 'userId', 'group', 'fld_x', 'actions']);
    assert.deepEqual(ids(arrangeable(COLS, p)), ['email', 'userId', 'group', 'fld_x']);
    assert.deepEqual(moveColumn(COLS, p, 'email', -1), reconcile(COLS, p), 'already first');
    p = toggleColumn(COLS, p, 'name', false);
    assert.ok(ids(visibleColumns(COLS, p)).includes('name'));
  });
  it('reconciles saved prefs: unknown ids drop, new columns appear in their default place and visibility', () => {
    const saved = { order: ['group', 'email', 'gone'], hidden: ['gone'] };
    const p = reconcile(COLS, saved);
    assert.deepEqual(p.order, ['name', 'group', 'email', 'userId', 'fld_x', 'actions']);
    assert.deepEqual(p.hidden, ['fld_x']);
    assert.deepEqual(reconcile(COLS, { nonsense: true }), defaultPrefs(COLS));
  });
  it('loads and saves through the given storage, tolerating junk', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    savePrefs('k', { order: ['email'], hidden: [] }, storage);
    assert.deepEqual(loadPrefs('k', storage), { order: ['email'], hidden: [] });
    store.set('k', '{bad');
    assert.equal(loadPrefs('k', storage), null);
  });
});
