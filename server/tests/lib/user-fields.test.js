import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFieldDefinition, mergeFieldValues, missingRequiredFields, visibleFieldValues,
  getFieldDefinitions, generateFieldId,
} from '../../src/lib/user-fields.js';

const DEFS = [
  { id: 'fld_org', label: 'Organization', type: 'text', required: true },
  { id: 'fld_bio', label: 'Bio', type: 'textarea', required: false },
  { id: 'fld_role', label: 'Role', type: 'dropdown', required: true, options: ['Teacher', 'Student'] },
  { id: 'fld_site', label: 'Website', type: 'link', required: false },
  { id: 'fld_phone', label: 'Phone', type: 'phone', required: false },
];

describe('user-fields: definitions', () => {
  it('generates prefixed ids', () => {
    assert.match(generateFieldId(), /^fld_[0-9a-f]{12}$/);
  });

  it('reads definitions defensively', () => {
    assert.deepEqual(getFieldDefinitions(undefined), []);
    assert.deepEqual(getFieldDefinitions({ userFields: 'nope' }), []);
    assert.deepEqual(getFieldDefinitions({ userFields: DEFS }), DEFS);
  });

  it('normalizes a valid definition', () => {
    const { field, error } = validateFieldDefinition({ label: '  School ', type: 'text', required: 1 });
    assert.equal(error, undefined);
    assert.equal(field.label, 'School');
    assert.equal(field.required, true);
    assert.match(field.id, /^fld_/);
    assert.equal(field.options, undefined);
  });

  it('rejects missing label and unknown type', () => {
    assert.ok(validateFieldDefinition({ type: 'text' }).error);
    assert.ok(validateFieldDefinition({ label: 'X', type: 'date' }).error);
  });

  it('dedupes/trims dropdown options and requires at least one', () => {
    const { field } = validateFieldDefinition({ label: 'Role', type: 'dropdown', options: [' A ', 'A', '', 'B'] });
    assert.deepEqual(field.options, ['A', 'B']);
    assert.ok(validateFieldDefinition({ label: 'Role', type: 'dropdown', options: [' '] }).error);
  });

  it('preserves the id of an existing field on update', () => {
    const { field } = validateFieldDefinition({ label: 'Org 2', type: 'text' }, DEFS[0]);
    assert.equal(field.id, 'fld_org');
  });
});

describe('user-fields: values', () => {
  it('merges a patch, trimming and dropping unknown ids', () => {
    const { values, error } = mergeFieldValues(DEFS, { fld_bio: 'old' }, { fld_org: '  UIC ', fld_nope: 'x' });
    assert.equal(error, undefined);
    assert.deepEqual(values, { fld_bio: 'old', fld_org: 'UIC' });
  });

  it('prunes stored values whose definition was deleted', () => {
    const { values } = mergeFieldValues(DEFS, { fld_gone: 'x', fld_bio: 'kept' }, {});
    assert.deepEqual(values, { fld_bio: 'kept' });
  });

  it('clears a value on empty string / null', () => {
    const { values } = mergeFieldValues(DEFS, { fld_bio: 'old', fld_site: 'https://a.b' }, { fld_bio: '', fld_site: null });
    assert.deepEqual(values, {});
  });

  it('enforceRequired: the merged result must have every required field', () => {
    const full = { fld_org: 'UIC', fld_role: 'Teacher' };
    assert.equal(mergeFieldValues(DEFS, full, { fld_org: '' }, { enforceRequired: true }).error, 'Organization is required');
    // A required field that was never filled blocks the save too, not just an explicit clear.
    assert.equal(mergeFieldValues(DEFS, {}, { fld_bio: 'hi' }, { enforceRequired: true }).error, 'Required: Organization, Role');
    // A stale dropdown value counts as missing.
    assert.equal(mergeFieldValues(DEFS, { fld_org: 'UIC', fld_role: 'Gone' }, {}, { enforceRequired: true }).error, 'Role is required');
    assert.deepEqual(mergeFieldValues(DEFS, full, { fld_bio: 'hi' }, { enforceRequired: true }).values, { ...full, fld_bio: 'hi' });
  });

  it('without enforceRequired (signup), required fields may be blank', () => {
    assert.deepEqual(mergeFieldValues(DEFS, { fld_org: 'UIC' }, { fld_org: '' }).values, {});
  });

  it('validates dropdown, link, and phone formats', () => {
    assert.ok(mergeFieldValues(DEFS, {}, { fld_role: 'Janitor' }).error);
    assert.equal(mergeFieldValues(DEFS, {}, { fld_role: 'Teacher' }).values.fld_role, 'Teacher');
    assert.ok(mergeFieldValues(DEFS, {}, { fld_site: 'javascript:alert(1)' }).error);
    assert.ok(mergeFieldValues(DEFS, {}, { fld_site: 'not a url' }).error);
    assert.equal(mergeFieldValues(DEFS, {}, { fld_site: 'https://example.com' }).values.fld_site, 'https://example.com');
    assert.ok(mergeFieldValues(DEFS, {}, { fld_phone: '12' }).error);
    assert.ok(mergeFieldValues(DEFS, {}, { fld_phone: 'call me' }).error);
    assert.equal(mergeFieldValues(DEFS, {}, { fld_phone: '+1 (312) 555-0100' }).values.fld_phone, '+1 (312) 555-0100');
  });

  it('enforces length limits and string type', () => {
    assert.ok(mergeFieldValues(DEFS, {}, { fld_org: 'x'.repeat(201) }).error);
    assert.equal(mergeFieldValues(DEFS, {}, { fld_bio: 'x'.repeat(2000) }).error, undefined);
    assert.ok(mergeFieldValues(DEFS, {}, { fld_org: 42 }).error);
    assert.ok(mergeFieldValues(DEFS, {}, ['x']).error);
  });

  it('reports missing required fields, including stale dropdown values', () => {
    assert.deepEqual(missingRequiredFields(DEFS, undefined), ['fld_org', 'fld_role']);
    assert.deepEqual(missingRequiredFields(DEFS, { fld_org: 'UIC', fld_role: 'Teacher' }), []);
    assert.deepEqual(missingRequiredFields(DEFS, { fld_org: 'UIC', fld_role: 'Removed option' }), ['fld_role']);
  });

  it('exposes only values with a current definition', () => {
    assert.deepEqual(visibleFieldValues(DEFS, { fld_org: 'UIC', fld_gone: 'x' }), { fld_org: 'UIC' });
    assert.deepEqual(visibleFieldValues(DEFS, null), {});
  });
});
