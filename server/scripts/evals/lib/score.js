/**
 * Pass marks (docs/AGENT_EVALS.md section 3), applied to the trials of one
 * check in one case:
 *
 * - never    one failing trial fails it, when the check is `critical` (a
 *            slip that harms a learner: completing without the work, a
 *            recorded approval, a changed link or code, AI suspicion, a
 *            made-up fact). Otherwise a failure is confirmed (run.js): the
 *            case runs again on both versions, and it fails only if it
 *            happens again, or more often than today (Blake, 2026-11-24).
 * - parity   it fails when its failure rate is worse than today's (the
 *            baseline) by more than normal variation: the larger of the gap
 *            seen between two runs of today's version (calibration) and a
 *            binomial margin for the number of trials. With no baseline (an
 *            agent new in this version), a case's `minPass` applies if it
 *            has one; otherwise it is reported as "no baseline yet".
 * - reading  collected for the reading panel; never fails.
 * - pending  plato doesn't do this yet; reported, never fails.
 */
export const MARKS = ['never', 'parity', 'reading', 'pending'];

/** Two-sided 95% margin for the difference of two failure rates. */
export function noiseMargin(p1, n1, p2, n2) {
  const p = (p1 * n1 + p2 * n2) / Math.max(1, n1 + n2);
  return 1.96 * Math.sqrt(Math.max(p * (1 - p), 0.25 / Math.max(n1, n2, 1)) * (1 / Math.max(n1, 1) + 1 / Math.max(n2, 1)));
}

/**
 * One check's verdict. `trials` are booleans (true = passed; null = not
 * applicable). `baseline` is `{ fails, n }` for the same case and check, or
 * null. `gap` is the calibration gap for it (0 when unknown).
 */
export function judge({ mark, trials, extra = null, critical = false, baseline = null, gap = 0, minPass = null }) {
  // A non-critical "never" that was confirmed: it fails if the confirmation
  // trials fail too, or if all its trials together are worse than today.
  if (mark === 'never' && !critical && extra) {
    const first = judge({ mark, trials });
    const again = extra.filter((t) => t === false).length;
    const all = judge({ mark: 'parity', trials: [...trials, ...extra], baseline, gap, minPass: null });
    if (all.verdict === 'n/a') return { ...all, mark };
    const worse = baseline?.n ? all.verdict === 'fail' : false;
    // "Happens again": it failed in the first trials and in the confirmation
    // trials. A single slip that only shows up among the extra trials (a case
    // confirmed for another check) isn't a repeat.
    return { ...all, mark, firstFails: first.fails, againFails: again, confirmed: true, verdict: (first.fails && again) || worse ? 'fail' : 'pass' };
  }
  if (extra) trials = [...trials, ...extra];
  const ran = trials.filter((t) => t !== null);
  const n = ran.length;
  const fails = ran.filter((t) => t === false).length;
  const rate = n ? fails / n : 0;
  const out = { mark, n, fails, rate };
  if (!n) return { ...out, verdict: 'n/a' };
  if (mark === 'never') return { ...out, verdict: fails ? 'fail' : 'pass' };
  if (mark === 'reading' || mark === 'pending') return { ...out, verdict: mark };
  if (baseline && baseline.n) {
    const baseRate = baseline.fails / baseline.n;
    const margin = Math.max(gap, noiseMargin(rate, n, baseRate, baseline.n));
    return { ...out, baseRate, margin, verdict: rate > baseRate + margin ? 'fail' : 'pass' };
  }
  if (minPass != null) return { ...out, minPass, verdict: 1 - rate < minPass ? 'fail' : 'pass' };
  return { ...out, verdict: 'no-baseline' };
}

/** A whole run's verdict: any failing check fails it. */
export function runVerdict(cases) {
  const checks = cases.flatMap((c) => Object.values(c.checks));
  const count = (v) => checks.filter((x) => x.verdict === v).length;
  return {
    verdict: count('fail') ? 'fail' : 'pass',
    checks: checks.length, failed: count('fail'), passed: count('pass'), noBaseline: count('no-baseline'), pending: count('pending'), reading: count('reading'),
  };
}
