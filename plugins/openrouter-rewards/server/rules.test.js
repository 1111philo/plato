import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, validateSharedPolicy } from './rules.js';

describe('OpenRouter reward rules', () => {
  it('does not match fired, pending, or reserved rule IDs', () => {
    const state = {
      firedRuleIds: ['fired'],
      pendingClaim: { ruleIds: ['pending'] },
      reservations: [{ ruleIds: ['reserved'] }],
    };
    const rules = ['fired', 'pending', 'reserved', 'fresh'].map((id) => ({
      id,
      enabled: true,
      trigger: 'lesson-count',
      value: 1,
    }));
    assert.deepEqual(evaluateRules(rules, state, [{ lessonId: 'l1' }], 'l1').map((r) => r.id), ['fresh']);
  });

  it('matches specific-lesson rules by just-completed lesson', () => {
    const rules = [{ id: 'specific', enabled: true, trigger: 'specific-lesson', value: 'lesson-a' }];
    assert.deepEqual(evaluateRules(rules, {}, [], 'lesson-a').map((r) => r.id), ['specific']);
  });

  it('rejects incompatible key policies', () => {
    assert.throws(
      () => validateSharedPolicy([
        { enabled: true, limitReset: 'monthly', expiresAfterDays: null },
        { enabled: true, limitReset: 'weekly', expiresAfterDays: null },
      ]),
      /same reset cadence/
    );
  });
});
