import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authenticatedFetch } from '../../js/auth.js';
import { getLessonKB } from '../../js/storage.js';

// 1.8 min/exchange matches the ~20 min / 11 exchange target used in AdminHome
const MINS_PER_EXCHANGE = 1.8;

function formatTimeRange(p20, p80) {
  if (p20 == null || p80 == null) return null;
  const low = Math.round(p20 * MINS_PER_EXCHANGE);
  const high = Math.round(p80 * MINS_PER_EXCHANGE);
  if (low === high) return `~${low} min`;
  return `${low}–${high} min`;
}

function TimeTag({ p20, p80, sampleSize }) {
  const label = formatTimeRange(p20, p80);
  if (!label || !sampleSize || sampleSize < 3) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full"
      title={`Based on the middle 60% of ${sampleSize} learner completion${sampleSize !== 1 ? 's' : ''}`}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      </svg>
      {label}
    </span>
  );
}

function LessonCard({ lesson, lessonKB, timeStats, onClick }) {
  const progress = lessonKB?.progress ?? 0;
  const isCompleted = lessonKB?.status === 'completed';
  const hasStarted = progress > 0 || (lessonKB && !isCompleted);

  let statusLabel = null;
  let statusClass = '';
  if (isCompleted) {
    statusLabel = 'Completed';
    statusClass = 'text-green-600 bg-green-50 border border-green-200';
  } else if (hasStarted) {
    statusLabel = `In progress (${progress}/10)`;
    statusClass = 'text-blue-600 bg-blue-50 border border-blue-200';
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold leading-tight">{lesson.name}</h2>
        {statusLabel && (
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusClass}`}>
            {statusLabel}
          </span>
        )}
      </div>
      {lesson.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">{lesson.description}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap mt-1">
        <TimeTag
          p20={timeStats?.p20}
          p80={timeStats?.p80}
          sampleSize={timeStats?.sampleSize}
        />
      </div>
    </button>
  );
}

export default function Lessons() {
  const [lessons, setLessons] = useState([]);
  const [lessonKBs, setLessonKBs] = useState({});
  const [timeStatsMap, setTimeStatsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Lessons — plato';
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const resp = await authenticatedFetch('/v1/lessons');
        if (!resp.ok) throw new Error('Failed to load lessons');
        const data = await resp.json();
        setLessons(data);

        // Load KBs for progress display
        const kbs = {};
        await Promise.all(
          data.map(async (l) => {
            try {
              const kb = await getLessonKB(l.lessonId);
              if (kb) kbs[l.lessonId] = kb;
            } catch { /* ignore */ }
          })
        );
        setLessonKBs(kbs);

        // Load time stats (best-effort — non-blocking)
        try {
          const statsResp = await authenticatedFetch('/v1/lessons/time-stats');
          if (statsResp.ok) {
            const statsData = await statsResp.json();
            setTimeStatsMap(statsData);
          }
        } catch { /* ignore — time tags are optional */ }
      } catch (err) {
        console.error('Failed to load lessons:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-muted-foreground text-sm">Loading lessons…</div>
      </div>
    );
  }

  if (!lessons.length) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold mb-2">No lessons yet</h1>
        <p className="text-muted-foreground">Check back soon — your instructor will publish lessons here.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Lessons</h1>
      <p className="text-muted-foreground mb-6 text-sm">Choose a lesson to begin.</p>
      <div className="flex flex-col gap-3">
        {lessons.map((lesson) => (
          <LessonCard
            key={lesson.lessonId}
            lesson={lesson}
            lessonKB={lessonKBs[lesson.lessonId]}
            timeStats={timeStatsMap[lesson.lessonId]}
            onClick={() => navigate(`/lesson/${lesson.lessonId}`)}
          />
        ))}
      </div>
    </div>
  );
}
