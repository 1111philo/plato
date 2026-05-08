import { Fragment, useState, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getLessonKB } from '../../js/storage.js';
import { authenticatedFetch } from '../../js/auth.js';
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

  // Apply the course filter.
  const filtered = useMemo(() => {
    if (courseFilter === FILTER_ALL) return lessons;
    if (courseFilter === FILTER_NONE) return lessons.filter((l) => !l.course?.id);
    return lessons.filter((l) => l.course?.id === courseFilter);
  }, [lessons, courseFilter]);

  // Pagination math. We clamp the current page to the available range so a
  // filter that shrinks the list below the current page doesn't strand us.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleLessons = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Reset to page 1 whenever the filter changes so we never land on an
  // out-of-range page after a tighter filter.
  useEffect(() => { setPage(1); }, [courseFilter]);

  // Live announcement: assembled from filter + page state. Updates whenever
  // either changes, which is exactly the moment screen reader users need to
  // know the visible content shifted. Kept in an always-mounted sr-only
  // region so the announcement fires reliably (a region that appears for
  // the first time on render is sometimes missed).
  const filterLabel = useMemo(() => {
    if (courseFilter === FILTER_ALL) return 'all courses';
    if (courseFilter === FILTER_NONE) return 'lessons without a course';
    const name = courseOptions.named.find((c) => c.id === courseFilter)?.name;
    return name ? `the course "${name}"` : 'the selected course';
  }, [courseFilter, courseOptions.named]);

  const announcement = useMemo(() => {
    // Empty while still loading. Once `loaded` flips, the live region's
    // content changes from '' to a real announcement — that content change
    // is what reliably fires the screen-reader announcement (live regions
    // commonly skip initial-mount content). Avoids double-announcement
    // with the visible "Loading lessons…" div below.
    if (!loaded) return '';
    const total = filtered.length;
    // Skip the "in <filter>" scope phrase when no course filter is shown —
    // saying "in all courses" in a classroom without any courses would be
    // misleading.
    const scope = hasCourseFilter ? ` in ${filterLabel}` : '';
    if (lessons.length === 0) return 'No lessons yet.';
    if (total === 0) {
      return hasCourseFilter ? `No lessons match ${filterLabel}.` : 'No lessons.';
    }
    const lessonWord = total === 1 ? 'lesson' : 'lessons';
    if (totalPages === 1) {
      return `Showing ${total} ${lessonWord}${scope}.`;
    }
    const showingFrom = pageStart + 1;
    const showingTo = pageStart + visibleLessons.length;
    return `Showing ${showingFrom} to ${showingTo} of ${total} ${lessonWord}${scope}, page ${currentPage} of ${totalPages}.`;
  }, [loaded, lessons.length, filtered.length, filterLabel, totalPages, pageStart, visibleLessons.length, currentPage, hasCourseFilter]);

  function statusIcon(lessonId) {
    const d = lessonData[lessonId];
    if (d?.status === 'completed') return '✓';
    if (d?.status) return '▶';
    return '○';
  }

  function progressLabel(lesson) {
    const d = lessonData[lesson.lessonId];
    if (d?.status === 'completed') return 'Completed';
    if (d?.progress != null) return `${d.progress * 10}% toward exemplar`;
    if (d?.status) return 'In progress';
    return null;
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Lessons</h2>
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
                progressText={progressLabel(c)}
                timeStats={timeStats[c.lessonId]}
                statusGlyph={statusIcon(c.lessonId)}
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
          open={!!detailLesson}
          onOpenChange={(open) => { if (!open) setDetailLesson(null); }}
        />
      )}
    </div>
  );
}

function LessonCard({ lesson, progressText, timeStats, statusGlyph, onOpen, onShowOverview }) {
  // Stable id per card so the open-lesson button can describe itself with
  // the meta strip — Tab navigation then announces course/time/status as
  // supplementary context, instead of forcing screen-reader users to
  // switch into reading mode just to discover those signals.
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
      title: `Based on the middle 60% of ${timeStats.sampleSize} ${completionWord}`,
      aria: `Estimated completion time ${range}, based on ${timeStats.sampleSize} ${completionWord}`,
    });
  }
  if (progressText) {
    parts.push({ key: 'status', text: progressText });
  }

  return (
    <Card className="h-full transition-shadow hover:shadow-md group gap-0 p-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open lesson ${lesson.name}`}
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
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary"
            aria-hidden="true"
          >
            {statusGlyph}
          </span>
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
                  <span title={part.title} aria-label={part.aria}>{part.text}</span>
                ) : part.text}
              </span>
            </Fragment>
          ))}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-xs h-auto px-2 py-1 text-primary hover:underline shrink-0"
          onClick={onShowOverview}
          aria-label={`View ${lesson.learningObjectives.length} objectives for ${lesson.name}`}
        >
          Overview ({lesson.learningObjectives.length})
        </Button>
      </div>
    </Card>
  );
}

function LessonDetailDialog({ lesson, progress, open, onOpenChange }) {
  const pct = progress?.status === 'completed' ? 100 : (progress?.progress != null ? progress.progress * 10 : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lesson.name}</DialogTitle>
          {lesson.description && (
            <DialogDescription>{lesson.description}</DialogDescription>
          )}
        </DialogHeader>

        {lesson.course?.name && (
          <p className="text-sm text-muted-foreground">Part of <span className="font-medium">{lesson.course.name}</span></p>
        )}

        {pct != null && (
          <div
            className="space-y-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`Lesson progress: ${pct}%`}
          >
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>Starting</span>
              <span>{progress.status === 'completed' ? 'Completed' : `${pct}%`}</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Exemplar</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{lesson.exemplar}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Learning Objectives</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-1">
            {lesson.learningObjectives.map((obj, i) => (
              <li key={i}>{obj}</li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
