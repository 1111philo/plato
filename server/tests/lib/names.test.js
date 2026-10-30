/**
 * First / last names (#402, src/lib/names.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitName, joinName, nameFields, readNameInput, MAX_NAME_PART } from '../../src/lib/names.js';

describe('splitName', () => {
  it('splits at the first whitespace and keeps every part', () => {
    assert.deepEqual(splitName('Ada Lovelace'), { firstName: 'Ada', lastName: 'Lovelace', parts: 2 });
    assert.deepEqual(splitName('José María García López'), { firstName: 'José', lastName: 'María García López', parts: 4 });
    assert.deepEqual(splitName('  Padded   Name  '), { firstName: 'Padded', lastName: 'Name', parts: 2 });
  });
  it('one word is a first name; empty is empty', () => {
    assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '', parts: 1 });
    assert.deepEqual(splitName(''), { firstName: '', lastName: '', parts: 0 });
    assert.deepEqual(splitName(null), { firstName: '', lastName: '', parts: 0 });
  });
});

describe('joinName', () => {
  it('joins trimmed parts and drops an empty last name', () => {
    assert.equal(joinName(' Mary ', ' Ann  Evans '), 'Mary Ann Evans');
    assert.equal(joinName('Cher', ''), 'Cher');
  });
});

describe('nameFields', () => {
  it('reads stored parts', () => {
    assert.deepEqual(nameFields({ name: 'stale', firstName: 'Ada', lastName: 'Lovelace', nameSource: 'user' }),
      { name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', nameSource: 'user' });
  });
  it('splits a record from before #402, as auto', () => {
    assert.deepEqual(nameFields({ name: 'Mary Ann Evans' }), { name: 'Mary Ann Evans', firstName: 'Mary', lastName: 'Ann Evans', nameSource: 'auto' });
    assert.deepEqual(nameFields(null), { name: '', firstName: '', lastName: '', nameSource: 'auto' });
  });
});

describe('readNameInput', () => {
  it('prefers firstName/lastName over name', () => {
    assert.deepEqual(readNameInput({ firstName: 'Ada', lastName: 'King', name: 'ignored' }).fields,
      { firstName: 'Ada', lastName: 'King', name: 'Ada King', nameSource: 'user' });
  });
  it('splits a lone name, as auto', () => {
    assert.deepEqual(readNameInput({ name: 'Ada King' }).fields, { firstName: 'Ada', lastName: 'King', name: 'Ada King', nameSource: 'auto' });
  });
  it('fills a missing part from the current record', () => {
    assert.equal(readNameInput({ lastName: 'King' }, { current: { firstName: 'Ada', lastName: 'Lovelace' } }).fields.name, 'Ada King');
  });
  it('no name in the body: nothing to write, unless required', () => {
    assert.deepEqual(readNameInput({ email: 'x' }), { fields: null });
    assert.match(readNameInput({}, { required: true }).error, /first name is required/i);
  });
  it('rejects a blank first name, non-text, and over-long parts', () => {
    assert.ok(readNameInput({ firstName: ' ' }).error);
    assert.ok(readNameInput({ firstName: 5 }).error);
    assert.ok(readNameInput({ firstName: 'a', lastName: 'x'.repeat(MAX_NAME_PART + 1) }).error);
  });
});
