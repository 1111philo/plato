export const RESET_OPTIONS = [
  { value: '', label: 'No reset' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const VALID_TRIGGERS = new Set(['lesson-count', 'specific-lesson']);
const VALID_RESETS = new Set(RESET_OPTIONS.map((option) => option.value));

export function createDefaultRule(id = 'first-lesson') {
  return {
    id,
    name: 'First lesson',
    enabled: true,
    trigger: 'lesson-count',
    value: 1,
    creditAmount: 1,
    limitReset: 'monthly',
    expiresAfterDays: null,
  };
}

function toNullableInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive whole number.`);
  }
  return numeric;
}

function toPositiveInteger(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive whole number.`);
  }
  return numeric;
}

function toPositiveNumber(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }
  return numeric;
}

export function normalizeRewardRules(rules = []) {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index) => {
    const fallback = createDefaultRule(`reward-${index + 1}`);
    const trigger = VALID_TRIGGERS.has(rule?.trigger) ? rule.trigger : fallback.trigger;
    const limitReset = rule?.limitReset || '';

    return {
      id: String(rule?.id || fallback.id).trim(),
      name: String(rule?.name || fallback.name).trim(),
      enabled: rule?.enabled !== false,
      trigger,
      value: trigger === 'lesson-count'
        ? Number(rule?.value || fallback.value)
        : String(rule?.value || '').trim(),
      creditAmount: Number(rule?.creditAmount || fallback.creditAmount),
      limitReset: VALID_RESETS.has(limitReset) && limitReset ? limitReset : null,
      expiresAfterDays: rule?.expiresAfterDays === '' ? null : (rule?.expiresAfterDays ?? fallback.expiresAfterDays),
    };
  });
}

export function validateRewardRules(rules = []) {
  if (!Array.isArray(rules)) throw new Error('Reward rules must be a list.');

  const normalized = rules.map((rawRule, index) => {
    const label = `Rule ${index + 1}`;
    const trigger = rawRule?.trigger || 'lesson-count';
    const rule = normalizeRewardRules([rawRule])[0];
    if (!rule.id) throw new Error(`${label} needs an id.`);
    if (!rule.name) throw new Error(`${label} needs a name.`);
    if (!VALID_TRIGGERS.has(trigger)) throw new Error(`${label} has an invalid trigger.`);

    const limitReset = rawRule?.limitReset || '';
    if (!VALID_RESETS.has(limitReset)) throw new Error(`${label} has an invalid reset cadence.`);

    return {
      ...rule,
      trigger,
      value: trigger === 'lesson-count'
        ? toPositiveInteger(rawRule?.value, `${label} completed lessons`)
        : String(rawRule?.value || '').trim(),
      creditAmount: toPositiveNumber(rawRule?.creditAmount, `${label} credit amount`),
      limitReset: limitReset || null,
      expiresAfterDays: toNullableInteger(rawRule?.expiresAfterDays, `${label} expiry`),
    };
  });

  for (const rule of normalized) {
    if (rule.trigger === 'specific-lesson' && !rule.value) {
      throw new Error(`${rule.name} needs a lesson id.`);
    }
  }

  const enabled = normalized.filter((rule) => rule.enabled);
  const first = enabled[0];
  if (first) {
    for (const rule of enabled.slice(1)) {
      if (rule.limitReset !== first.limitReset || rule.expiresAfterDays !== first.expiresAfterDays) {
        throw new Error('All OpenRouter reward rules must use the same reset cadence and expiry in this version.');
      }
    }
  }

  return normalized;
}
