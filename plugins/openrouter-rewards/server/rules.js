export function evaluateRules(rules, state = {}, completions = [], justCompletedLessonId = null) {
  const firedOrPending = new Set([
    ...(state.firedRuleIds ?? []),
    ...(state.pendingClaim?.ruleIds ?? []),
    ...((state.reservations ?? []).flatMap((r) => r.ruleIds ?? [])),
  ]);

  return (rules || []).filter((rule) => {
    if (!rule?.enabled) return false;
    if (firedOrPending.has(rule.id)) return false;
    if (rule.trigger === 'lesson-count') return completions.length >= Number(rule.value || 0);
    if (rule.trigger === 'specific-lesson') {
      return rule.value === justCompletedLessonId || completions.some((c) => c.lessonId === rule.value);
    }
    return false;
  });
}

export function validateSharedPolicy(rules = []) {
  const enabled = rules.filter((rule) => rule.enabled);
  if (enabled.length <= 1) return;
  const first = enabled[0];
  for (const rule of enabled.slice(1)) {
    if (rule.limitReset !== first.limitReset || rule.expiresAfterDays !== first.expiresAfterDays) {
      throw new Error('All OpenRouter reward rules must use the same reset cadence and expiry in this version.');
    }
  }
}

export function buildAward(rules, { targetLimit = null } = {}) {
  const amount = rules.reduce((sum, rule) => sum + Number(rule.creditAmount || 0), 0);
  return {
    amount,
    targetLimit: targetLimit ?? amount,
    ruleIds: rules.map((rule) => rule.id),
    ruleNames: rules.map((rule) => rule.name || rule.id),
    limitReset: rules[0]?.limitReset ?? null,
    expiresAfterDays: rules[0]?.expiresAfterDays ?? null,
  };
}
