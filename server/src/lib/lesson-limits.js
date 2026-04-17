// Microlearning constraints — mirrors client/src/lib/constants.js.
// The client constants file is the canonical source of truth.
export const MAX_EXCHANGES = 11;
export const MIN_OBJECTIVES = 2;
export const MAX_OBJECTIVES = 4;

// Pacing categories for lesson-length KPI aggregation.
export const PACING_ON_TARGET = 'on-target';
export const PACING_NEAR_LIMIT = 'near-limit';
export const PACING_OVER_TARGET = 'over-target';
export const PACING_HARD_LIMIT = 'hard-limit';

export function classifyPacing(exchangeCount) {
  if (exchangeCount >= MAX_EXCHANGES * 2) return PACING_HARD_LIMIT;
  if (exchangeCount >= MAX_EXCHANGES) return PACING_OVER_TARGET;
  if (exchangeCount >= MAX_EXCHANGES - 3) return PACING_NEAR_LIMIT;
  return PACING_ON_TARGET;
}
