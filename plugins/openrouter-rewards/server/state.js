// Fields written by the pre-Model-Y OAuth flow. The OAuth dance was removed in the
// Model Y rewrite; these names are retained here only so legacy persisted state can
// be stripped on read instead of being carried forward indefinitely.
const LEGACY_OAUTH_FIELDS = ['pendingClaim', 'oauthSessions', 'openrouterUserId'];

const DEFAULT_AWARD_RESERVATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REISSUE_RESERVATION_TTL_MS = DEFAULT_AWARD_RESERVATION_TTL_MS;

export function emptyState() {
  return {
    keyHash: null,
    activeKeyPolicy: null,
    lifetimeAwarded: 0,
    firedRuleIds: [],
    pendingReissue: null,
    reissueReservation: null,
    reservations: [],
    deliveryAttempts: [],
  };
}

export function normalizeState(state) {
  const filtered = { ...(state || {}) };
  for (const field of LEGACY_OAUTH_FIELDS) delete filtered[field];
  return { ...emptyState(), ...filtered };
}

// Pre-Model-Y `/claim` could leave award reservations in 'reserved' phase forever
// when the OAuth callback never fired. /check-pending refuses to evaluate new rules
// while an award reservation exists, so without this helper those users would be
// stuck. We never drop 'external-succeeded' reservations — that phase marks an
// irreversible OpenRouter side effect that still needs finalization.
export function pruneStaleAwardReservations(stateInput, { now = new Date(), staleAfterMs = DEFAULT_AWARD_RESERVATION_TTL_MS } = {}) {
  const state = normalizeState(stateInput);
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  return {
    ...state,
    reservations: (state.reservations || []).filter((r) => {
      if (r.phase === 'external-succeeded') return true;
      if (r.kind !== 'award') return true;
      return (r.createdAt || '') > cutoff;
    }),
  };
}

export function pruneStaleReissueReservation(stateInput, { now = new Date(), staleAfterMs = DEFAULT_REISSUE_RESERVATION_TTL_MS } = {}) {
  const state = normalizeState(stateInput);
  const reservation = state.reissueReservation;
  if (!reservation || reservation.phase === 'external-succeeded') return state;
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  if ((reservation.createdAt || '') > cutoff) return state;
  return {
    ...state,
    reissueReservation: null,
  };
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
  return {
    ...state,
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

export function finalizeAwardReservation(stateInput, reservationId, { keyHash, awardedAt }) {
  const state = normalizeState(stateInput);
  const reservation = state.reservations.find((item) => item.id === reservationId);
  if (!reservation) return state;
  const fired = new Set([...(state.firedRuleIds || []), ...reservation.ruleIds]);
  return {
    ...state,
    keyHash,
    lifetimeAwarded: (state.lifetimeAwarded || 0) + reservation.amount,
    firedRuleIds: [...fired],
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

export function markReissueExternalSucceeded(stateInput, { keyHash, externalSucceededAt }) {
  const state = normalizeState(stateInput);
  if (!state.reissueReservation) return state;
  return {
    ...state,
    reissueReservation: {
      ...state.reissueReservation,
      phase: 'external-succeeded',
      newKeyHash: keyHash,
      externalSucceededAt,
    },
  };
}

export function clearReissueReservation(stateInput, reservationId) {
  const state = normalizeState(stateInput);
  if (!state.reissueReservation || state.reissueReservation.id !== reservationId) return state;
  if (state.reissueReservation.phase === 'external-succeeded') {
    throw new Error('must not clear reissue reservation after external side effect succeeds');
  }
  return {
    ...state,
    reissueReservation: null,
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
