import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultRule,
  normalizeRewardRules,
  validateRewardRules,
} from './rule-utils.js';

describe('OpenRouter reward rule helpers', () => {
  it('creates editable default rules with stable ids', () => {
    assert.deepEqual(createDefaultRule('rule-1'), {
      id: 'rule-1',
      name: 'First lesson',
      enabled: true,
      trigger: 'lesson-count',
      value: 1,
      creditAmount: 1,
      limitReset: 'monthly',
      expiresAfterDays: null,
    });
  });

  it('normalizes persisted rules for the form without changing the settings shape', () => {
    assert.deepEqual(normalizeRewardRules([
      {
        id: 'welcome',
        name: 'Welcome key',
        enabled: false,
        trigger: 'specific-lesson',
        value: 'intro',
        creditAmount: '5',
        limitReset: '',
        expiresAfterDays: '',
      },
    ]), [
      {
        id: 'welcome',
        name: 'Welcome key',
        enabled: false,
        trigger: 'specific-lesson',
        value: 'intro',
        creditAmount: 5,
        limitReset: null,
        expiresAfterDays: null,
      },
    ]);
  });

  it('validates and serializes lesson-count rules', () => {
    const rules = validateRewardRules([
      {
        id: 'first',
        name: 'First lesson',
        enabled: true,
        trigger: 'lesson-count',
        value: '2',
        creditAmount: '3.5',
        limitReset: 'monthly',
        expiresAfterDays: '30',
      },
    ]);

    assert.deepEqual(rules, [
      {
        id: 'first',
        name: 'First lesson',
        enabled: true,
        trigger: 'lesson-count',
        value: 2,
        creditAmount: 3.5,
        limitReset: 'monthly',
        expiresAfterDays: 30,
      },
    ]);
  });

  it('rejects incompatible enabled rule policies', () => {
    assert.throws(() => validateRewardRules([
      {
        id: 'first',
        name: 'First',
        enabled: true,
        trigger: 'lesson-count',
        value: 1,
        creditAmount: 1,
        limitReset: 'monthly',
        expiresAfterDays: null,
      },
      {
        id: 'second',
        name: 'Second',
        enabled: true,
        trigger: 'lesson-count',
        value: 2,
        creditAmount: 1,
        limitReset: 'weekly',
        expiresAfterDays: null,
      },
    ]), /same reset cadence and expiry/);
  });

  it('requires a lesson id for specific-lesson rules', () => {
    assert.throws(() => validateRewardRules([
      {
        id: 'specific',
        name: 'Specific lesson',
        enabled: true,
        trigger: 'specific-lesson',
        value: '',
        creditAmount: 1,
        limitReset: 'monthly',
        expiresAfterDays: null,
      },
    ]), /lesson id/i);
  });

  it('requires a completed-lesson threshold for lesson-count rules', () => {
    assert.throws(() => validateRewardRules([
      {
        id: 'count',
        name: 'Lesson count',
        enabled: true,
        trigger: 'lesson-count',
        value: '',
        creditAmount: 1,
        limitReset: 'monthly',
        expiresAfterDays: null,
      },
    ]), /completed lessons/i);
  });

  it('rejects unknown trigger types', () => {
    assert.throws(() => validateRewardRules([
      {
        id: 'bad',
        name: 'Bad trigger',
        enabled: true,
        trigger: 'profile-updated',
        value: 1,
        creditAmount: 1,
        limitReset: 'monthly',
        expiresAfterDays: null,
      },
    ]), /invalid trigger/i);
  });
});
