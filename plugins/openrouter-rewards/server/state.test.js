import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  claimFingerprint,
  createPendingClaim,
  existingPendingResponse,
  reserveAward,
  clearReservation,
  markReservationExternalSucceeded,
  finalizeAwardReservation,
} from './state.js';

describe('OpenRouter reward state machine', () => {
  it('returns an existing pending claim before evaluating new rules', () => {
    const state = {
      ...emptyState(),
      pendingClaim: {
        ruleIds: ['rule-1'],
        reservationIds: ['res-1'],
        accumulatedAmount: 5,
        qualifiedAt: '2026-05-05T12:00:00.000Z',
        claimFingerprint: 'sha256:abc',
      },
    };

    assert.deepEqual(existingPendingResponse(state), {
      status: 'pending-oauth',
      accumulatedAmount: 5,
      ruleIds: ['rule-1'],
    });
  });

  it('fingerprints pending claims from stable rule IDs and amount', () => {
    const a = createPendingClaim([{ id: 'b' }, { id: 'a' }], 5, '2026-05-05T12:00:00.000Z');
    const b = createPendingClaim([{ id: 'a' }, { id: 'b' }], 5, '2026-05-05T12:00:00.000Z');
    assert.equal(a.claimFingerprint, b.claimFingerprint);
    assert.equal(claimFingerprint(a), a.claimFingerprint);
  });

  it('does not clear a reservation after an external side effect succeeds', () => {
    const state = reserveAward(emptyState(), [{ id: 'rule-1', creditAmount: 5 }], {
      amount: 5,
      targetLimit: 5,
      reservationId: 'res-1',
      createdAt: '2026-05-05T12:00:00.000Z',
    });
    const afterExternal = markReservationExternalSucceeded(state, 'res-1', { keyHash: 'hash_1' });

    assert.throws(
      () => clearReservation(afterExternal, 'res-1', { externalSucceeded: true }),
      /must not clear/
    );
  });

  it('finalizes a reservation exactly once', () => {
    const state = reserveAward(emptyState(), [{ id: 'rule-1', creditAmount: 5 }], {
      amount: 5,
      targetLimit: 5,
      reservationId: 'res-1',
      createdAt: '2026-05-05T12:00:00.000Z',
    });

    const next = finalizeAwardReservation(state, 'res-1', {
      keyHash: 'hash_1',
      awardedAt: '2026-05-05T12:01:00.000Z',
    });

    assert.deepEqual(next.firedRuleIds, ['rule-1']);
    assert.equal(next.lifetimeAwarded, 5);
    assert.equal(next.keyHash, 'hash_1');
    assert.equal(next.reservations.length, 0);
  });
});
