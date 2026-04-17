import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPacing,
  PACING_ON_TARGET,
  PACING_NEAR_LIMIT,
  PACING_OVER_TARGET,
  PACING_HARD_LIMIT,
} from '../../src/lib/lesson-limits.js';

describe('classifyPacing', () => {
  it('returns on-target for exchangeCount < 8', () => {
    assert.equal(classifyPacing(0), PACING_ON_TARGET);
    assert.equal(classifyPacing(7), PACING_ON_TARGET);
  });

  it('returns near-limit for exchangeCount 8–10 (boundary at 8)', () => {
    assert.equal(classifyPacing(8), PACING_NEAR_LIMIT);
    assert.equal(classifyPacing(10), PACING_NEAR_LIMIT);
  });

  it('returns over-target for exchangeCount 11–21 (boundary at 11)', () => {
    assert.equal(classifyPacing(11), PACING_OVER_TARGET);
    assert.equal(classifyPacing(21), PACING_OVER_TARGET);
  });

  it('returns hard-limit for exchangeCount >= 22 (boundary at 22)', () => {
    assert.equal(classifyPacing(22), PACING_HARD_LIMIT);
    assert.equal(classifyPacing(30), PACING_HARD_LIMIT);
  });
});
