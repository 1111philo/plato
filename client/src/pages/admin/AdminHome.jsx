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

  // Flag when over-target lessons are running significantly long (≥13 exchanges avg).
  // Threshold lowered from 15 to catch lesson-design issues before they compound.
  const overTargetWarning = avgExchangesOverTarget != null && avgExchangesOverTarget >= 13;

  // Flag when a meaningful fraction of completions are going over target (>20%).
  // Threshold lowered from 25% for earlier visibility into pacing regressions.
  const overTargetFraction = hasCompletions ? overTarget / totalCompletions : 0;
  const overTargetFractionHigh = overTargetFraction > 0.20;

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
      signalDetail = (
        overTargetFraction > 0.35
          ? `Over ${Math.round(overTargetFraction * 100)}% of completions exceeded the ${exchangeTarget}-exchange target` +
            (avgExchangesOverTarget != null ? `, averaging ${avgExchangesOverTarget} exchanges` : '') +
            `. This typically means lessons have too many objectives or an exemplar that requires many coaching rounds. ` +
            `Try reducing each lesson to 2 focused objectives and narrowing the exemplar scope. ` +
            `Consider splitting any lesson with 3–4 broad objectives into two focused lessons.`
          : `Common causes: too many learning objectives, an exemplar that sets a very high bar, or a lesson topic ` +
            `that requires more scaffolding exchanges. Try simplifying objectives to 2–3 focused outcomes or ` +
            `tightening the exemplar scope.`
      );
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
                More than 1 in 5 completions ran long — consider reviewing lesson scope.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{extendedLessons}</div>
            <div
              className="text-sm text-muted-foreground"
              title={`Completed lessons that ran past ${extendedThreshold} exchanges (2× the target). Informational — a signal the lesson design or starting point mismatched, not a failure of the coach or learner.`}
            >
              Extended lessons
            </div>
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
      setActiveCount(Array.isArray(users) ? users.filter(u => u.role !== 'admin').length : 0);
      setPendingCount(Array.isArray(invites) ? invites.filter(i => i.status === 'pending').length : 0);
      setHasKB(!!(kb && kb.content && kb.content.trim()));
      setLessonStats(stats || null);
    }).catch(() => {});
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
            <div className="text-sm text-muted-foreground">Active learners</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
            <div className="text-sm text-muted-foreground">Pending invites</div>
          </CardContent>
        </Card>
        <Card className={!hasKB ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{hasKB ? '✓' : '!'}</div>
            <div className="text-sm text-muted-foreground">Knowledge base</div>
            {!hasKB && (
              <div className="text-xs mt-1 text-yellow-800">
                No knowledge base yet.{' '}
                <Link to="/plato/knowledge-base" className="underline">Add one</Link> to improve coach quality.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {lessonStats && <PacingSection stats={lessonStats} />}
    </div>
  );
}
