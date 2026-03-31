import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signAccessToken, verifyAccessToken } from '../../src/lib/jwt.js';

describe('JWT', () => {
  it('signs and verifies a token', async () => {
    const token = await signAccessToken('usr_test123', 'admin');
    const payload = await verifyAccessToken(token);
    assert.equal(payload.sub, 'usr_test123');
    assert.equal(payload.role, 'admin');
    assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered token', async () => {
    const token = await signAccessToken('usr_test123', 'participant');
    const tampered = token.slice(0, -5) + 'xxxxx';
    await assert.rejects(() => verifyAccessToken(tampered));
  });

  it('includes iat claim', async () => {
    const token = await signAccessToken('usr_test', 'participant');
    const payload = await verifyAccessToken(token);
    assert.ok(payload.iat);
    assert.ok(payload.iat <= Math.floor(Date.now() / 1000) + 1);
  });
});
