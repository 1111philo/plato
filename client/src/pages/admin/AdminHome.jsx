import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';

function PacingSection({ stats }) {
  const {
    totalCompletions = 0, withinTarget = 0, overTarget = 0, hitHardLimit = 0,
    exchangeTarget = 11, hardLimit = 22, avgExchangesWithinTarget,
    avgDurationMinutes, activeCourses = 0,
  } = stats;

  const hasCompletions = totalCompletions > 0;
  const rate = hasCompletions ? Math.round((withinTarget / totalCompletions) * 100) : null;

  let cardClasses = '';
  let signal = '';
  if (rate !== null) {
    if (rate >= 75) {
      cardClasses = 'border-green-300 bg-green-50 ring-2 ring-green-200';
      signal = 'Course pacing is healthy';
    } else if (rate >= 50) {
      cardClasses = 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200';
      signal = 'Some courses are running long — review objectives or coach pacing';
    } else {
      cardClasses = 'border-red-300 bg-red-50 ring-2 ring-red-200';
      signal = 'Most courses exceed the target — simplify objectives or raise the target';
    }
  }

  return (
    <>
      <h2 className="text-lg font-semibold mt-8 mb-4">Course Pacing</h2>

      <Card className={`mb-4 ${cardClasses}`}>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm font-medium">On-Target Rate</div>
              <div className="text-4xl font-bold mt-1">{rate !== null ? `${rate}%` : '—'}</div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>Target: {exchangeTarget} exchanges (~20 min)</div>
              <div>Hard limit: {hardLimit} exchanges</div>
            </div>
          </div>
          {hasCompletions ? (
            <>
              <div className="text-sm mt-2">
                {withinTarget} of {totalCompletions} completed course{totalCompletions !== 1 ? 's' : ''} finished
                within {exchangeTarget} exchanges
              </div>
              <div className="text-sm font-semibold mt-1">{signal}</div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">
              No completed courses yet. Stats will appear once learners finish courses.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card className={avgDurationMinutes != null && avgDurationMinutes > 20 ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{avgDurationMinutes != null ? `${avgDurationMinutes} min` : '—'}</div>
            <div className="text-sm text-muted-foreground">Avg time to complete</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{avgExchangesWithinTarget ?? '—'}</div>
            <div className="text-sm text-muted-foreground">Avg exchanges (on target)</div>
          </CardContent>
        </Card>
        <Card className={overTarget > 0 ? 'border-yellow-300 bg-yellow-50 ring-2 ring-yellow-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{overTarget}</div>
            <div className="text-sm text-muted-foreground">Went over target</div>
          </CardContent>
        </Card>
        <Card className={hitHardLimit > 0 ? 'border-red-300 bg-red-50 ring-2 ring-red-200' : ''}>
          <CardContent>
            <div className="text-2xl font-bold">{hitHardLimit}</div>
            <div className="text-sm text-muted-foreground">Hit hard limit</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{activeCourses}</div>
            <div className="text-sm text-muted-foreground">Active courses</div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function AdminHome() {
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [contentUpdateCount, setContentUpdateCount] = useState(0);
  const [courseStats, setCourseStats] = useState(null);

  useEffect(() => {
    document.title = 'Admin — plato';
    Promise.all([
      adminApi('GET', '/v1/admin/users'),
      adminApi('GET', '/v1/admin/invites'),
      adminApi('GET', '/v1/admin/content-updates'),
      adminApi('GET', '/v1/admin/stats/courses'),
    ]).then(([users, invites, contentUpdates, stats]) => {
      setActiveCount(Array.isArray(users) ? users.length : 0);
      setPendingCount(Array.isArray(invites) ? invites.filter(i => i.status === 'pending').length : 0);
      setContentUpdateCount(contentUpdates?.count || 0);
      setCourseStats(stats);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-6">Manage users and settings for plato.</p>

      {contentUpdateCount > 0 && (
        <Link to="/plato/content-updates" className="block no-underline mb-6">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 hover:bg-blue-100 transition-colors" role="alert">
            <strong>{contentUpdateCount} content update{contentUpdateCount !== 1 ? 's' : ''} available</strong> from the latest version of plato.{' '}
            <span className="underline">Review updates</span>
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

      {courseStats && <PacingSection stats={courseStats} />}
    </div>
  );
}
