import { Fragment, useState, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getLessonKB } from '../../js/storage.js';
import { authenticatedFetch } from '../../js/auth.js';
import Check from 'lucide-react/dist/esm/icons/check';
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

// 1.8 min/exchange matches the ~20 min / 11 exchange MAX_EXCHANGES target.
const MINS_PER_EXCHANGE = 1.8;
const PAGE_SIZE = 12;

// Sentinel filter values. 'all' shows everything; 'none' isolates lessons
// that have no course assigned (e.g. legacy or admin-personal customs).
const FILTER_ALL = 'all';
const FILTER_NONE = 'none';

// Status filter values map to the lessonKB.status field on each lesson:
// completed → status === 'completed'; in-progress → any truthy non-completed
// status; not-started → no kb record at all.
const STATUS_ALL = 'all';
const STATUS_NOT_STARTED = 'not-started';
const STATUS_IN_PROGRESS = 'in-progress';
const STATUS_COMPLETED = 'completed';

function lessonStatusKey(d) {
  if (d?.status === 'completed') return STATUS_COMPLETED;
  if (d?.status) return STATUS_IN_PROGRESS;
  return STATUS_NOT_STARTED;
}

// Single source of truth for the human-readable status announcement (used
// both by the icon's aria-label/title and by the open-lesson button's
// accessible name). Keeping it here means SR users hear the same wording
// no matter which path led them to the status info.
function statusAnnouncement(d) {
  if (d?.status === 'completed') return 'Completed';
  if (d?.status) {
    const pct = d.progress != null ? d.progress * 10 : null;
    return pct != null ? `In progress, ${pct}% complete` : 'In progress';
  }
  return 'Not started';
}

function formatTimeRange(p20, p80) {
  if (typeof p20 !== 'number' || typeof p80 !== 'number') return null;
  const low = Math.round(p20 * MINS_PER_EXCHANGE);
  const high = Math.round(p80 * MINS_PER_EXCHANGE);
  if (low === high) return `~${low} min`;
  return `${low}–${high} min`;
}

export default function LessonsList() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { lessons, loaded } = state;
  const [lessonData, setLessonData] = useState({});
  const [timeStats, setTimeStats] = useState({});
  const [detailLesson, setDetailLesson] = useState(null);
  const [courseFilter, setCourseFilter] = useState(FILTER_ALL);
  const [statusFilter, setStatusFilter] = useState(STATUS_ALL);
  const [page, setPage] = useState(1);

  useEffect(() => {
    (async () => {
      const data = {};
      for (const c of lessons) {
        const kb = await getLessonKB(c.lessonId);
        data[c.lessonId] = {
          status: kb?.status || null,
          progress: kb?.progress ?? null,
        };
      }
      setLessonData(data);
    })();
  }, [lessons]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authenticatedFetch('/v1/lessons/time-stats');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTimeStats(data || {});
      } catch { /* time tags are optional */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build the course list for the filter dropdown from the inlined `course`
  // field on each lesson. Sorted alphabetically. We add an "Uncategorized"
  // option only when at least one lesson has no course — so learners aren't
  // confronted with a meaningless option in classrooms where every lesson
  // belongs to a course. The whole filter UI is hidden when no courses
  // exist (named.length === 0) — there's nothing meaningful to filter by.
  const courseOptions = useMemo(() => {
    const map = new Map();
    let hasUncategorized = false;
    for (const l of lessons) {
      if (l.course?.id) map.set(l.course.id, l.course.name);
      else hasUncategorized = true;
    }
    const named = [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { named, hasUncategorized };
  }, [lessons]);
  const hasCourseFilter = courseOptions.named.length > 0;

  // If the classroom has no courses (or the only course referenced by the
  // current filter was just deleted server-side), fall back to "all" so the
  // user isn't stranded on a stale filter that matches nothing.
  useEffect(() => {
    if (!hasCourseFilter && courseFilter !== FILTER_ALL) {
      setCourseFilter(FILTER_ALL);
    } else if (
      courseFilter !== FILTER_ALL &&
      courseFilter !== FILTER_NONE &&
      !courseOptions.named.some((c) => c.id === courseFilter)
    ) {
      setCourseFilter(FILTER_ALL);
    }
  }, [hasCourseFilter, courseFilter, courseOptions.named]);

  // Apply both filters. Course narrows by taxonomy; status narrows by the
  // learner's progress on each lesson. Combined as logical AND so the grid
  // only shows lessons matching every active filter.
  const filtered = useMemo(() => {
    let result = lessons;
    if (courseFilter === FILTER_NONE) result = result.filter((l) => !l.course?.id);
    else if (courseFilter !== FILTER_ALL) result = result.filter((l) => l.course?.id === courseFilter);
    if (statusFilter !== STATUS_ALL) {
      result = result.filter((l) => lessonStatusKey(lessonData[l.lessonId]) === statusFilter);
    }
    // Sort by course name first (uncategorized lessons last), then by lesson
    // title within each course.
    return result.slice().sort((a, b) => {
      const courseA = a.course?.name || '';
      const courseB = b.course?.name || '';
      // Push lessons without courses to the end
      if (!courseA && courseB) return 1;
      if (courseA && !courseB) return -1;
      // Compare course names alphabetically
      const courseCompare = courseA.localeCompare(courseB, undefined, { numeric: true, sensitivity: 'base' });
      if (courseCompare !== 0) return courseCompare;
      // Within the same course (or both uncategorized), sort by lesson name
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [lessons, courseFilter, statusFilter, lessonData]);

  // Pagination math. We clamp the current page to the available range so a
  // filter that shrinks the list below the current page doesn't strand us.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleLessons = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Reset to page 1 whenever any filter changes so we never land on an
  // out-of-range page after a tighter filter.
  useEffect(() => { setPage(1); }, [courseFilter, statusFilter]);

  // Live announcement: assembled from filter + page state. Updates whenever
  // either changes, which is exactly the moment screen reader users need to
  // know the visible content shifted. Kept in an always-mounted sr-only
  // region so the announcement fires reliably (a region that appears for
  // the first time on render is sometimes missed).
  const filterPhrase = useMemo(() => {
    const phrases = [];
    if (courseFilter === FILTER_NONE) phrases.push('without a course');
    else if (courseFilter !== FILTER_ALL) {
      const name = courseOptions.named.find((c) => c.id === courseFilter)?.name;
      phrases.push(name ? `in the course "${name}"` : 'in the selected course');
    }
    if (statusFilter === STATUS_NOT_STARTED) phrases.push('not started');
    else if (statusFilter === STATUS_IN_PROGRESS) phrases.push('in progress');
    else if (statusFilter === STATUS_COMPLETED) phrases.push('completed');
    return phrases.join(', ');
  }, [courseFilter, statusFilter, courseOptions.named]);

  const announcement = useMemo(() => {
    // Empty while still loading. Once `loaded` flips, the live region's
    // content changes from '' to a real announcement — that content change
    // is what reliably fires the screen-reader announcement (live regions
    // commonly skip initial-mount content). Avoids double-announcement
    // with the visible "Loading lessons…" div below.
    if (!loaded) return '';
    const total = filtered.length;
    const scope = filterPhrase ? ` ${filterPhrase}` : '';
    if (lessons.length === 0) return 'No lessons yet.';
    if (total === 0) {
      return filterPhrase ? `No lessons ${filterPhrase}.` : 'No lessons.';
    }
    const lessonWord = total === 1 ? 'lesson' : 'lessons';
    if (totalPages === 1) {
      return `Showing ${total} ${lessonWord}${scope}.`;
    }
    const showingFrom = pageStart + 1;
    const showingTo = pageStart + visibleLessons.length;
    return `Showing ${showingFrom} to ${showingTo} of ${total} ${lessonWord}${scope}, page ${currentPage} of ${totalPages}.`;
  }, [loaded, lessons.length, filtered.length, filterPhrase, totalPages, pageStart, visibleLessons.length, currentPage]);

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Lessons</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {hasCourseFilter && (
            <div className="flex items-center gap-2">
              <label htmlFor="course-filter" className="text-sm text-muted-foreground">Course</label>
              <select
                id="course-filter"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value={FILTER_ALL}>All courses</option>
                {courseOptions.named.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {courseOptions.hasUncategorized && (
                  <option value={FILTER_NONE}>Uncategorized</option>
                )}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="status-filter" className="text-sm text-muted-foreground">Status</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value={STATUS_ALL}>All statuses</option>
              <option value={STATUS_NOT_STARTED}>Not started</option>
              <option value={STATUS_IN_PROGRESS}>In progress</option>
              <option value={STATUS_COMPLETED}>Completed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Always-mounted live region. Updates whenever filter or page changes.
          Persistent rather than conditional so screen readers reliably pick
          up the change. No visible counterpart — sighted learners get the
          same signal from the grid itself shifting and the pagination row. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {!loaded ? (
        // Plain visible state — no role/aria-live here. The sr-only live
        // region above is the single announcer; it fires when its content
        // transitions from '' (loading) to "Showing N lessons" (loaded).
        <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          Loading lessons…
        </div>
      ) : lessons.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          No lessons yet.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          No lessons match this filter.
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          role="list"
          aria-label="Lessons"
        >
          {visibleLessons.map((c, i) => (
            <li
              key={c.lessonId}
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both list-none"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {/* Title-first layout: lesson name leads, description supports,
                  and metadata (course / expected time / status) collapses to
                  one muted line in the footer. The Open and Overview triggers
                  are sibling buttons so screen readers never see
                  interactive-within-interactive. */}
              <LessonCard
                lesson={c}
                progress={lessonData[c.lessonId]}
                timeStats={timeStats[c.lessonId]}
                onOpen={() => navigate(`/lessons/${c.lessonId}`)}
                onShowOverview={() => setDetailLesson(c)}
              />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav aria-label="Lessons pagination" className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            &larr; Previous
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums" aria-current="page">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next page"
          >
            Next &rarr;
          </Button>
        </nav>
      )}

      {detailLesson && (
        <LessonDetailDialog
          lesson={detailLesson}
          progress={lessonData[detailLesson.lessonId]}
          timeStats={timeStats[detailLesson.lessonId]}
          open={!!detailLesson}
          onOpenChange={(open) => { if (!open) setDetailLesson(null); }}
        />
      )}
    </div>
  );
}

function LessonCard({ lesson, progress, timeStats, onOpen, onShowOverview }) {
  // Stable id per card so the open-lesson button can describe itself with
  // the meta strip — Tab navigation announces course + time as
  // supplementary context (status now lives in the indicator and the
  // button label, so it's not duplicated here).
  const metaId = useId();

  const range = timeStats && (timeStats.sampleSize ?? 0) >= 3
    ? formatTimeRange(timeStats.p20, timeStats.p80)
    : null;

  const parts = [];
  if (lesson.lessonId.startsWith('custom-')) {
    parts.push({ key: 'custom', text: 'My Lesson' });
  }
  if (lesson.course?.name) {
    parts.push({ key: 'course', text: lesson.course.name });
  }
  if (range) {
    const completionWord = `learner completion${timeStats.sampleSize === 1 ? '' : 's'}`;
    parts.push({
      key: 'time',
      text: range,
      // Tooltip-only context. SR reads the short visible "18–23 min"
      // instead of a verbose "Estimated completion time …, based on N
      // learners" override — that footnote, repeated on every Tab
      // through the grid, adds up fast. Sighted hover still surfaces
      // the empirical detail.
      title: `Based on the middle 60% of ${timeStats.sampleSize} ${completionWord}`,
    });
  }

  const statusText = statusAnnouncement(progress);

  return (
    <Card className="h-full transition-shadow hover:shadow-md group gap-0 p-0">
      <button
        type="button"
        onClick={onOpen}
        // Status is folded into the button's accessible name — the visual
        // indicator is aria-hidden, so without this the icon's meaning
        // would be invisible to SR users.
        aria-label={`Open lesson ${lesson.name}. ${statusText}.`}
        aria-describedby={parts.length > 0 ? metaId : undefined}
        className="flex-1 text-left px-4 pt-4 pb-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <h3 className="text-base font-semibold leading-snug transition-colors group-hover:text-primary">
              {lesson.name}
            </h3>
            {lesson.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                {lesson.description}
              </p>
            )}
          </div>
          <StatusIndicator progress={progress} statusText={statusText} />
        </div>
      </button>
      <div className="px-4 pb-3 pt-1 flex items-baseline gap-2 flex-wrap">
        {/* Visible separators are middle-dots; screen readers read commas
            instead so the run-on string parses as a list with natural
            pauses. */}
        <p
          id={metaId}
          className="text-xs text-muted-foreground flex-1 min-w-0 leading-relaxed"
        >
          {/* Each item is whitespace-nowrap so wrapping happens between
              items (clean line endings), not inside a phrase. The leading
              separator lives inside the nowrap span so when the line wraps,
              the dot travels with the item it precedes — no orphan " ·"
              dangling at the end of a line. SR users hear sr-only commas
              between items instead of the visible middle-dot, which gives
              natural pauses in the reading flow. */}
          {parts.map((part, idx) => (
            <Fragment key={part.key}>
              {idx > 0 && (
                <>
                  {' '}
                  <span className="sr-only">, </span>
                </>
              )}
              <span className="whitespace-nowrap">
                {idx > 0 && <span aria-hidden="true">· </span>}
                {part.title ? (
                  <span title={part.title}>{part.text}</span>
                ) : part.text}
              </span>
            </Fragment>
          ))}
        </p>
        {/* Icon-only "?" button so it doesn't compete with the primary
            "Open lesson" affordance. Sighted users get a familiar
            help-style glyph; SR users get the full "View N objectives for
            {name}" label. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 w-7 p-0 text-muted-foreground hover:text-primary shrink-0"
          onClick={onShowOverview}
          aria-label={`View ${lesson.learningObjectives.length} objectives for ${lesson.name}`}
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}

// Visual status indicator that doubles as a progress meter. Three
// well-differentiated states with distinct hues so the icon is
// glanceable in a grid without relying on shape alone:
//   - not-started: muted gray outline ring
//   - in-progress: amber arc on amber wash (warm "in flight" cue, kept
//     out of the brand palette so it doesn't blend into themed UI)
//   - completed:   green check on green wash
// The visual is aria-hidden — the matching status text is folded into
// the open-lesson button's aria-label, and `title` gives sighted hover
// users the precise % when the arc alone is hard to read.
function StatusIndicator({ progress, statusText }) {
  const sharedClass = 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full';
  if (progress?.status === 'completed') {
    return (
      <span
        aria-hidden="true"
        title={statusText}
        className={`${sharedClass} bg-emerald-100 text-emerald-700`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (progress?.status) {
    const pct = progress.progress != null ? progress.progress * 10 : 0;
    return (
      <span
        aria-hidden="true"
        title={statusText}
        className={`${sharedClass} bg-amber-100 text-amber-700`}
      >
        <ProgressRing pct={pct} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      title={statusText}
      className={`${sharedClass} border border-muted-foreground/30 text-muted-foreground/40`}
    />
  );
}

function ProgressRing({ pct, size = 22, stroke = 2.5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={half} cy={half} r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth={stroke} />
      <circle
        cx={half}
        cy={half}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${half} ${half})`}
      />
    </svg>
  );
}

function LessonDetailDialog({ lesson, progress, timeStats, open, onOpenChange }) {
  const pct = progress?.status === 'completed' ? 100 : (progress?.progress != null ? progress.progress * 10 : null);
  const progressText = progress?.status === 'completed' ? 'Completed' : (pct != null ? `${pct}% complete` : null);
  const range = timeStats && (timeStats.sampleSize ?? 0) >= 3
    ? formatTimeRange(timeStats.p20, timeStats.p80)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* Course tag above the title — establishes scope before the
              learner reads the title, matches the card's visual order. */}
          {lesson.course?.name && (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {lesson.course.name}
            </p>
          )}
          <DialogTitle>{lesson.name}</DialogTitle>
          {lesson.description && (
            <DialogDescription>{lesson.description}</DialogDescription>
          )}
        </DialogHeader>

        {/* Body sections share consistent vertical spacing so the dialog
            reads as a structured outline (Progress → Expected time →
            Exemplar → Objectives) rather than a stack of loose blocks. */}
        <div className="space-y-5">
          {pct != null && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium">Your progress</h3>
                <span aria-hidden="true" className="text-sm tabular-nums text-muted-foreground">
                  {progressText}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={progressText}
                className="h-2 rounded-full bg-muted overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {range && (
            <div>
              <h3 className="text-sm font-medium mb-1">Expected time</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Most learners finish in {range}, based on {timeStats.sampleSize} learner completion{timeStats.sampleSize === 1 ? '' : 's'}.
              </p>
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium mb-1">Exemplar</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{lesson.exemplar}</p>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-1">Learning objectives</h3>
            <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-1">
              {lesson.learningObjectives.map((obj, i) => (
                <li key={i}>{obj}</li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
