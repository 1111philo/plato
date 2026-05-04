import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';

// Estimate active lesson time from exchange count.
// Wall-clock duration (completedAt - startedAt) is unreliable because learners
// often leave tabs open between sessions. 1.8 min/exchange matches observed
// pacing for the ~20 min / 11 exchange target.
const MINS_PER_EXCHANGE = 1.8;

function estimateDuration(avgExchangesPerCompletion) {
  if (avgExchangesPerCompletion == null) return null;
  return Math.round(avgExchangesPerCompletion * MINS_PER_EXCHANGE * 10) / 10;
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
        <Card className={overTargetFractionHigh ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : (overTarget > 0 ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : '')}>
          <CardContent>
            <div className="text-2xl font-bold">{overTarget}</div>
            <div className="text-sm text-muted-foreground">Went over target</div>
            {overTargetFractionHigh && (
              <div className="text-xs mt-1 text-yellow-800">
                {Math.round(overTargetFraction * 100)}% of completions — consider reviewing lesson scope.
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

  useEffect(() => {
    document.title = 'Admin — plato';
    Promise.all([
      adminApi('GET', '/v1/admin/users'),
      adminApi('GET', '/v1/admin/invites'),
      adminApi('GET', '/v1/admin/knowledge-base'),
      adminApi('GET', '/v1/admin/stats/lessons'),
    ]).then(([users, invites, kb, stats]) => {
      setActiveCount(Array.isArray(users) ? users.length : 0);
      setPendingCount(Array.isArray(invites) ? invites.filter(i => i.status === 'pending').length : 0);
      setHasKB(!!kb?.content);
      setLessonStats(stats);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-6">Manage users and settings for plato.</p>

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

      {lessonStats && <PacingSection stats={lessonStats} />}
    </div>
  );
}
