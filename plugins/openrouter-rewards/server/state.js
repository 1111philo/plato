import { createHash } from 'node:crypto';

export function emptyState() {
  return {
    openrouterUserId: null,
    keyHash: null,
    activeKeyPolicy: null,
    lifetimeAwarded: 0,
    firedRuleIds: [],
    pendingClaim: null,
    oauthSessions: [],
    pendingReissue: null,
    reissueReservation: null,
    reservations: [],
    deliveryAttempts: [],
  };
}

export function normalizeState(state) {
  return { ...emptyState(), ...(state || {}) };
}

export function claimFingerprint(pendingClaim) {
  const stable = JSON.stringify({
    ruleIds: [...(pendingClaim?.ruleIds || [])].sort(),
    amount: pendingClaim?.accumulatedAmount || 0,
  });
  return `sha256:${createHash('sha256').update(stable).digest('hex')}`;
}

export function existingPendingResponse(state) {
  if (!state?.pendingClaim) return null;
  return {
    status: 'pending-oauth',
    accumulatedAmount: state.pendingClaim.accumulatedAmount,
    ruleIds: state.pendingClaim.ruleIds || [],
  };
}

export function createPendingClaim(rules, amount, qualifiedAt) {
  const pending = {
    ruleIds: rules.map((rule) => rule.id),
    reservationIds: [],
    accumulatedAmount: amount,
    qualifiedAt,
  };
  pending.claimFingerprint = claimFingerprint(pending);
  return pending;
}

export function reserveAward(stateInput, rules, { amount, targetLimit, reservationId, createdAt }) {
  const state = normalizeState(stateInput);
  const ruleIds = rules.map((rule) => rule.id);
  const reservation = {
    id: reservationId,
    kind: 'award',
    phase: 'reserved',
    ruleIds,
    amount,
    targetLimit,
    createdAt,
  };
  const pendingClaim = state.openrouterUserId
    ? state.pendingClaim
    : (state.pendingClaim || createPendingClaim(rules, amount, createdAt));
  return {
    ...state,
    pendingClaim: pendingClaim
      ? { ...pendingClaim, reservationIds: [...new Set([...(pendingClaim.reservationIds || []), reservationId])] }
      : null,
    reservations: [...(state.reservations || []), reservation],
  };
}

export function clearReservation(stateInput, reservationId, { externalSucceeded = false } = {}) {
  const state = normalizeState(stateInput);
  const reservation = state.reservations.find((item) => item.id === reservationId);
  if (externalSucceeded || reservation?.phase === 'external-succeeded') {
    throw new Error('must not clear reservation after external side effect succeeds');
  }
  return {
    ...state,
    reservations: state.reservations.filter((item) => item.id !== reservationId),
  };
}

export function markReservationExternalSucceeded(stateInput, reservationId, external) {
  const state = normalizeState(stateInput);
  return {
    ...state,
    reservations: state.reservations.map((reservation) => (
      reservation.id === reservationId
        ? { ...reservation, phase: 'external-succeeded', external }
        : reservation
    )),
  };
}

export function finalizeAwardReservation(stateInput, reservationId, { keyHash, awardedAt, openrouterUserId = null }) {
  const state = normalizeState(stateInput);
  const reservation = state.reservations.find((item) => item.id === reservationId);
  if (!reservation) return state;
  const fired = new Set([...(state.firedRuleIds || []), ...reservation.ruleIds]);
  const pendingClaim = state.pendingClaim
    ? {
        ...state.pendingClaim,
        ruleIds: (state.pendingClaim.ruleIds || []).filter((id) => !reservation.ruleIds.includes(id)),
        reservationIds: (state.pendingClaim.reservationIds || []).filter((id) => id !== reservationId),
      }
    : null;
  return {
    ...state,
    openrouterUserId: openrouterUserId || state.openrouterUserId,
    keyHash,
    lifetimeAwarded: (state.lifetimeAwarded || 0) + reservation.amount,
    firedRuleIds: [...fired],
    pendingClaim: pendingClaim && pendingClaim.ruleIds.length ? pendingClaim : null,
    reservations: state.reservations.filter((item) => item.id !== reservationId),
    lastAwardedAt: awardedAt,
    issuedAt: state.issuedAt || awardedAt,
  };
}

export function reserveReissue(stateInput, { reservationId, oldKeyHash, remainingCredit, createdAt }) {
  const state = normalizeState(stateInput);
  return {
    ...state,
    reissueReservation: {
      id: reservationId,
      oldKeyHash,
      remainingCredit,
      phase: 'reserved',
      createdAt,
    },
  };
}

export function finalizeReissue(stateInput, { keyHash, reissuedAt }) {
  const state = normalizeState(stateInput);
  return {
    ...state,
    keyHash,
    pendingReissue: null,
    reissueReservation: null,
    lastReissueAt: reissuedAt,
  };
}
