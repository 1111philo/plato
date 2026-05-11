import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';
import CompletionRing from './CompletionRing.jsx';

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-2xl font-semibold">{value ?? '—'}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function UserStatsPanel({ userId }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    adminApi('GET', `/v1/admin/users/${userId}/stats`)
      .then((data) => { if (!cancelled) { setStats(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load stats'); });
    return () => { cancelled = true; };
  }, [userId]);

  if (error) {
    return (
      <Card>
        <CardContent className="text-sm text-destructive">Failed to load activity: {error}</CardContent>
      </Card>
    );
  }
  if (!stats) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground" aria-busy="true">Loading activity…</CardContent>
      </Card>
    );
  }

  const {
    lessonsCompleted, lessonsAvailable,
    loginsInWindow,
    completionMinutesP50, completionMinutesP90,
    lessonDurations = [], windowDays,
  } = stats;

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-lg font-semibold">Activity <span className="text-sm font-normal text-muted-foreground">(last {windowDays} days)</span></h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          <div className="flex justify-center">
            <CompletionRing
              completed={lessonsCompleted}
              available={lessonsAvailable}
              size={96}
              label="Lessons completed"
            />
          </div>
          <StatTile label={`Logins (${windowDays}d)`} value={loginsInWindow} />
          <StatTile
            label="Median completion time"
            value={completionMinutesP50 != null ? `${completionMinutesP50} min` : '—'}
            sub={completionMinutesP90 != null ? `p90: ${completionMinutesP90} min` : null}
          />
        </div>

        {lessonDurations.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2">Completed lessons</h3>
            <ul className="text-sm space-y-1">
              {lessonDurations.slice(0, 20).map((l) => (
                <li key={l.lessonId + (l.completedAt || '')} className="flex items-baseline justify-between gap-3 border-b last:border-b-0 py-1">
                  <span className="truncate">{l.lessonName}</span>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {l.exchanges} ex · {l.minutes} min{l.completedAt ? ` · ${l.completedAt.slice(0, 10)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {lessonDurations.length > 20 && (
              <p className="text-xs text-muted-foreground mt-2">Showing 20 most recent of {lessonDurations.length}.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
