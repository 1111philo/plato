import { useState, useEffect } from 'react';
import { adminApi } from './adminApi.js';
import { Card, CardContent } from '@/components/ui/card';
import CompletionRing from './CompletionRing.jsx';

function Sparkline({ data, valueKey, label, formatValue }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey] || 0));
  const total = data.reduce((sum, d) => sum + (d[valueKey] || 0), 0);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{formatValue ? formatValue(total) : total}</span>
      </div>
      <div className="flex items-end gap-px h-12" role="img" aria-label={`${label}: ${formatValue ? formatValue(total) : total} over ${data.length} days`}>
        {data.map((d) => {
          const v = d[valueKey] || 0;
          const heightPct = max > 0 ? Math.max(2, (v / max) * 100) : 2;
          return (
            <div
              key={d.date}
              className={`flex-1 rounded-t ${v > 0 ? 'bg-primary/70' : 'bg-muted'}`}
              style={{ height: `${heightPct}%` }}
              title={`${d.date}: ${v}`}
            />
          );
        })}
      </div>
    </div>
  );
}

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
    lessonsCompleted, lessonsAvailable, lessonsInProgress,
    completionMinutesP50, completionMinutesP90,
    engagementMinutesByDay = [], loginsByDay = [], completedByDay = [],
    lessonDurations = [], windowDays,
  } = stats;

  const totalLogins = loginsByDay.reduce((s, d) => s + (d.count || 0), 0);

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-lg font-semibold">Activity <span className="text-sm font-normal text-muted-foreground">(last {windowDays} days)</span></h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-center">
          <div className="flex justify-center">
            <CompletionRing
              completed={lessonsCompleted}
              available={lessonsAvailable}
              size={96}
              label="Lessons completed"
            />
          </div>
          <StatTile label="In progress" value={lessonsInProgress} />
          <StatTile label={`Logins (${windowDays}d)`} value={totalLogins} />
          <StatTile
            label="Median completion time"
            value={completionMinutesP50 != null ? `${completionMinutesP50} min` : '—'}
            sub={completionMinutesP90 != null ? `p90: ${completionMinutesP90} min` : null}
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Sparkline data={engagementMinutesByDay} valueKey="minutes" label="Engagement / day" formatValue={(v) => `${v} min total`} />
          <Sparkline data={completedByDay} valueKey="count" label="Completed / day" formatValue={(v) => `${v} total`} />
          <Sparkline data={loginsByDay} valueKey="count" label="Logins / day" formatValue={(v) => `${v} total`} />
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
