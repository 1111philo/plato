import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, comparePassword } from '../../src/lib/password.js';

describe('password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('testpassword');
    assert.ok(hash.startsWith('$2a$'));
    assert.ok(await comparePassword('testpassword', hash));
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correctpassword');
    assert.ok(!(await comparePassword('wrongpassword', hash)));
  });

  it('produces different hashes for same input', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    assert.notEqual(h1, h2);
    assert.ok(await comparePassword('same', h1));
    assert.ok(await comparePassword('same', h2));
  });
});
