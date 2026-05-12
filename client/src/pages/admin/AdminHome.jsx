import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MINS_PER_EXCHANGE } from '@/lib/constants.js';

function formatRelativeTime(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

// Estimate active lesson time from exchange count.
// Wall-clock duration (completedAt - startedAt) is unreliable because learners
// often leave tabs open between sessions. 1.8 min/exchange matches observed
// pacing for the ~20 min / 11 exchange target.
function estimateDuration(avgExchangesPerCompletion) {
  if (avgExchangesPerCompletion == null) return null;
  return Math.round(avgExchangesPerCompletion * MINS_PER_EXCHANGE * 10) / 10;
}

function EngagementWidget({ label, valuePct, count, total, targetPct, targetCopy }) {
  const noData = valuePct == null;
  // Targets are phrased "over X%" so the threshold is strict — exactly the
  // target value is still below it. Matches the server's `> 0.5` per-learner rule.
  const onTarget = !noData && valuePct > targetPct;
  const cardClass = noData
    ? ''
    : onTarget
      ? 'border-green-300 bg-green-50 ring-2 ring-green-200'
      : 'border-red-300 bg-red-50 ring-2 ring-red-200';
  const badgeClass = noData
    ? 'bg-muted text-muted-foreground'
    : onTarget
      ? 'bg-green-200 text-green-900'
      : 'bg-red-200 text-red-900';
  const badgeText = noData ? '—' : onTarget ? 'On target' : 'Below target';
  return (
    <Card className={cardClass}>
      <CardContent>
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-4xl font-bold mt-1">{noData ? '—' : `${valuePct}%`}</div>
          </div>
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${badgeClass}`}>
            {badgeText}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-2">Target: {targetCopy}</div>
        {!noData && (
          <div className="text-sm mt-1">
            {count} of {total} learner{total !== 1 ? 's' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LearnerEngagementSection({ stats }) {
  const {
    activeLearners = 0,
    learnersStarted = 0,
    learnersCompletedHalf = 0,
    pctStarted = null,
    pctCompletedHalf = null,
    targetStartedPct = 90,
    targetCompletedHalfPct = 50,
  } = stats;

  if (activeLearners === 0) return null;

  return (
    <>
      <h2 className="text-lg font-semibold mt-8 mb-4">Learner Engagement</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EngagementWidget
          label="Started lessons"
          valuePct={pctStarted}
          count={learnersStarted}
          total={activeLearners}
          targetPct={targetStartedPct}
          targetCopy={`Over ${targetStartedPct}% of learners have started at least one lesson`}
        />
        <EngagementWidget
          label="Completed 50%+ of lessons"
          valuePct={pctCompletedHalf}
          count={learnersCompletedHalf}
          total={activeLearners}
          targetPct={targetCompletedHalfPct}
          targetCopy={`Over ${targetCompletedHalfPct}% of learners have completed more than half of their available lessons`}
        />
      </div>
    </>
  );
}

function PacingSection({ stats }) {
  const {
    totalCompletions = 0, withinTarget = 0, overTarget = 0, extendedLessons = 0,
    exchangeTarget = 11, extendedThreshold = 22, avgExchangesWithinTarget,
    avgExchangesOverTarget, avgExchangesPerCompletion, activeLessons = 0,
  } = stats;

  const hasCompletions = totalCompletions > 0;
  const rate = hasCompletions ? Math.round((withinTarget / totalCompletions) * 100) : null;

  // Use exchange-based estimated duration instead of wall-clock avgDurationMinutes
  // to avoid inflation from multi-session or abandoned-then-resumed lessons.
  const estimatedDuration = estimateDuration(avgExchangesPerCompletion);
  const durationWarning = estimatedDuration != null && estimatedDuration > 25;

  // Flag when over-target lessons are running significantly long (≥15 exchanges)
  const overTargetWarning = avgExchangesOverTarget != null && avgExchangesOverTarget >= 15;

  // Flag when a large fraction of completions are going over target (>25%)
  const overTargetFraction = hasCompletions ? overTarget / totalCompletions : 0;
  const overTargetFractionHigh = overTargetFraction > 0.25;

  let cardClasses = '';
  let signal = '';
  let signalDetail = null;
  if (rate !== null) {
    if (rate >= 75) {
      cardClasses = 'border-green-300 bg-green-50 ring-2 ring-green-200';
      signal = 'Lesson pacing is healthy';
    } else if (rate >= 50) {
      cardClasses = 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200';
      signal = 'Some lessons are running long — review objectives or coach pacing';
      signalDetail = 'Common causes: too many learning objectives, an exemplar that sets a very high bar, or a lesson topic that requires more scaffolding exchanges. Try simplifying objectives to 2–3 focused outcomes or tightening the exemplar scope.';
    } else {
      cardClasses = 'border-red-300 bg-red-50 ring-2 ring-red-200';
      signal = 'Most lessons exceed the target — simplify objectives or raise the target';
      signalDetail = 'Most learners are taking significantly more exchanges than the target. Review your lessons for scope creep: each lesson should target one narrow skill. Consider splitting broad lessons into two focused ones.';
    }
  }

  return (
    <>
      <h2 className="text-lg font-semibold mt-8 mb-4">Lesson Pacing</h2>

      <Card className={`mb-4 ${cardClasses}`}>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm font-medium">On-Target Rate</div>
              <div className="text-4xl font-bold mt-1">{rate !== null ? `${rate}%` : '—'}</div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>Target: {exchangeTarget} exchanges (~20 min)</div>
              <div>Extended threshold: {extendedThreshold}+ exchanges</div>
            </div>
          </div>
          {hasCompletions ? (
            <>
              <div className="text-sm mt-2">
                {withinTarget} of {totalCompletions} completed lesson{totalCompletions !== 1 ? 's' : ''} finished
                within {exchangeTarget} exchanges
              </div>
              <div className="text-sm font-semibold mt-1">{signal}</div>
              {signalDetail && (
                <div className="text-xs mt-2 text-muted-foreground">{signalDetail}</div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">
              No completed lessons yet. Stats will appear once learners finish lessons.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card className={durationWarning ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{estimatedDuration != null ? `${estimatedDuration} min` : '—'}</div>
            <div className="text-sm text-muted-foreground">Est. active time</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{avgExchangesWithinTarget ?? '—'}</div>
            <div className="text-sm text-muted-foreground">Avg exchanges (on target)</div>
          </CardContent>
        </Card>
        <Card className={overTargetWarning ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{avgExchangesOverTarget ?? '—'}</div>
            <div
              className="text-sm text-muted-foreground"
              title={`Average exchanges for the ${overTarget} lesson${overTarget !== 1 ? 's' : ''} that went over target. High values suggest a lesson design mismatch — too many objectives or a poorly-scoped exemplar.`}
            >
              Avg exchanges (over target)
            </div>
            {overTargetWarning && (
              <div className="text-xs mt-1 text-yellow-800">
                Over-target lessons averaging {avgExchangesOverTarget} exchanges — review lesson objectives and exemplar scope in{' '}
                <Link to="/plato/lessons" className="underline">Lessons</Link>.
              </div>
            )}
          </CardContent>
        </Card>
        <Card className={overTargetFractionHigh ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{overTarget}</div>
            <div className="text-sm text-muted-foreground">Went over target</div>
            {hasCompletions && (
              <div className="text-xs mt-1 text-muted-foreground">
                {Math.round(overTargetFraction * 100)}% of completions
              </div>
            )}
            {overTargetFractionHigh && (
              <div className="text-xs mt-1 text-yellow-800">
                More than 1 in 4 completions ran long — consider reviewing lesson scope.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{extendedLessons}</div>
            <div className="text-sm text-muted-foreground" title="Completed lessons that ran past 2× the target. Informational — a signal the lesson design or starting point mismatched, not a failure of the coach.">Extended lessons</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{activeLessons}</div>
            <div className="text-sm text-muted-foreground">Active lessons</div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function AdminHome() {
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasKB, setHasKB] = useState(true);
  const [lessonStats, setLessonStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAnnounce, setRefreshAnnounce] = useState('');

  const loadStats = useCallback(async ({ force = false } = {}) => {
    const path = force ? '/v1/admin/stats/lessons?refresh=1' : '/v1/admin/stats/lessons';
    return adminApi('GET', path);
  }, []);

  useEffect(() => {
    document.title = 'Admin — plato';
    Promise.all([
      adminApi('GET', '/v1/admin/users'),
      adminApi('GET', '/v1/admin/invites'),
      adminApi('GET', '/v1/admin/knowledge-base'),
      loadStats(),
    ]).then(([users, invites, kb, stats]) => {
      setActiveCount(Array.isArray(users) ? users.length : 0);
      setPendingCount(Array.isArray(invites) ? invites.filter(i => i.status === 'pending').length : 0);
      setHasKB(!!kb?.content);
      setLessonStats(stats);
    }).catch(() => {});
  }, [loadStats]);

  // Re-render the "Last updated" string every 30s so it stays accurate without
  // a refetch.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshAnnounce('');
    try {
      const stats = await loadStats({ force: true });
      setLessonStats(stats);
      setRefreshAnnounce('Stats refreshed.');
    } catch {
      setRefreshAnnounce('Refresh failed. Try again.');
    } finally {
      setRefreshing(false);
    }
  }

  const lastUpdated = formatRelativeTime(lessonStats?.computedAt);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground" aria-label={`Stats last updated ${lastUpdated}`}>
              Last updated {lastUpdated}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh dashboard stats"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground mb-6">Manage users and settings for plato.</p>
      <span className="sr-only" role="status" aria-live="polite">{refreshAnnounce}</span>

      {!hasKB && (
        <Link to="/plato/setup-kb" className="block no-underline mb-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100 transition-colors" role="alert">
            <strong>Set up your knowledge base</strong> — tell plato about your program so the AI can give learners informed answers.{' '}
            <span className="underline">Get started</span>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link to="/plato/users" className="no-underline">
          <Card className="hover:ring-2 hover:ring-primary/30 transition-shadow cursor-pointer">
            <CardContent>
              <div className="text-3xl font-bold">{activeCount}</div>
              <div className="text-sm text-muted-foreground">Active users</div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/plato/users" className="no-underline">
          <Card className="hover:ring-2 hover:ring-primary/30 transition-shadow cursor-pointer">
            <CardContent>
              <div className="text-3xl font-bold">{pendingCount}</div>
              <div className="text-sm text-muted-foreground">Pending invites</div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {lessonStats && <LearnerEngagementSection stats={lessonStats} />}
      {lessonStats && <PacingSection stats={lessonStats} />}
    </div>
  );
}
