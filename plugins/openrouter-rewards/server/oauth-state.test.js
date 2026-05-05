import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOauthSession,
  consumeOauthSession,
  pkceChallengeForVerifier,
} from './oauth-state.js';

describe('OpenRouter OAuth state binding', () => {
  it('binds state to the pending claim fingerprint and PKCE challenge', () => {
    const verifier = 'a'.repeat(64);
    const codeChallenge = pkceChallengeForVerifier(verifier);
    const state = {
      pendingClaim: { claimFingerprint: 'sha256:claim-a' },
      oauthSessions: [],
    };

    const { nextState, state: rawState } = buildOauthSession(state, {
      codeChallenge,
      now: new Date('2026-05-05T12:00:00.000Z'),
      randomBytes: () => Buffer.from('state-a'.repeat(6)),
    });

    const consumed = consumeOauthSession(nextState, {
      state: rawState,
      codeVerifier: verifier,
      now: new Date('2026-05-05T12:01:00.000Z'),
    });

    assert.equal(consumed.session.claimFingerprint, 'sha256:claim-a');
    assert.equal(consumed.nextState.oauthSessions.length, 0);
  });

  it('rejects callback state for a different pending claim', () => {
    const verifier = 'b'.repeat(64);
    const first = buildOauthSession({
      pendingClaim: { claimFingerprint: 'sha256:claim-a' },
      oauthSessions: [],
    }, {
      codeChallenge: pkceChallengeForVerifier(verifier),
      now: new Date('2026-05-05T12:00:00.000Z'),
      randomBytes: () => Buffer.from('state-b'.repeat(6)),
    });

    const tampered = {
      ...first.nextState,
      pendingClaim: { claimFingerprint: 'sha256:claim-b' },
    };

    assert.throws(
      () => consumeOauthSession(tampered, {
        state: first.state,
        codeVerifier: verifier,
        now: new Date('2026-05-05T12:01:00.000Z'),
      }),
      /pending claim changed/
    );
  });
});
