import { Fragment, useState, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getLessonKB } from '../../js/storage.js';
import { authenticatedFetch } from '../../js/auth.js';
import Check from 'lucide-react/dist/esm/icons/check';
import { completionBy, groupForDisplay, sortLessons } from '../lib/lessonOrder.js';
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
// that aren't in any course (units outside a course, unit-less lessons, and
// the learner's own customs).
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

  // Listen for lesson completion events to immediately update the checkmark
  useEffect(() => {
    const handleCompletion = async (e) => {
      const { lessonId } = e.detail;
      const kb = await getLessonKB(lessonId);
      setLessonData(prev => ({
        ...prev,
        [lessonId]: {
          status: kb?.status || null,
          progress: kb?.progress ?? null,
        },
      }));
    };
    window.addEventListener('plato:lesson-completed', handleCompletion);
    return () => window.removeEventListener('plato:lesson-completed', handleCompletion);
  }, []);

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

  // Build the course list for the filter dropdown from the inlined `program`
  // field on each lesson (a Course in the UI, #408), in the admin-defined
  // order. "Other lessons" appears only when at least one lesson is outside
  // every course. The whole filter UI is hidden when no courses exist.
  const courseOptions = useMemo(() => {
    const map = new Map();
    let hasUncategorized = false;
    for (const l of lessons) {
      if (l.program?.id) map.set(l.program.id, l.program);
      else hasUncategorized = true;
    }
    const named = [...map.values()].sort((a, b) =>
      (a.position ?? Infinity) - (b.position ?? Infinity)
      || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
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

  // Apply both filters (logical AND), then keep the Course → Unit → Lesson
  // order (lessonOrder.js).
  const filtered = useMemo(() => {
    let result = lessons;
    if (courseFilter === FILTER_NONE) result = result.filter((l) => !l.program?.id);
    else if (courseFilter !== FILTER_ALL) result = result.filter((l) => l.program?.id === courseFilter);
    if (statusFilter !== STATUS_ALL) {
      result = result.filter((l) => lessonStatusKey(lessonData[l.lessonId]) === statusFilter);
    }
    return sortLessons(result);
  }, [lessons, courseFilter, statusFilter, lessonData]);

  // Progress counts every lesson the learner has, not just the filtered
  // view, so a status filter can't skew "N of M" (#395).
  const progressByProgram = useMemo(() => completionBy('program', lessons, lessonData), [lessons, lessonData]);
  const progressByUnit = useMemo(() => completionBy('unit', lessons, lessonData), [lessons, lessonData]);
  const hasStructure = useMemo(() => lessons.some((l) => l.unit || l.program), [lessons]);

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
    if (courseFilter === FILTER_NONE) phrases.push('not in a course');
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
        <h1 className="text-xl font-semibold">Lessons</h1>
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
                  <option value={FILTER_NONE}>Other lessons</option>
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
        <div className="space-y-8">
          {/* Course (h2) → Unit (h3) runs on this page. Units outside a
              course take the h2 level so headings never skip. Counts come
              from all lessons, not from what's visible. */}
          {groupForDisplay(visibleLessons).map((group) => {
            const unitLevel = group.program ? 3 : 2;
            return (
              <section key={group.key} aria-labelledby={group.program ? `course-${group.key}` : undefined} className="space-y-5">
                {group.program && (
                  <ProgressHeader
                    id={`course-${group.key}`}
                    level={2}
                    name={group.program.name}
                    progress={progressByProgram[group.program.id]}
                  />
                )}
                {group.key === 'start-here' && <h2 className="text-base font-semibold mb-3">Start here</h2>}
                {group.units.map((u) => {
                  const unitName = group.key === 'start-here' ? null : u.unit?.name || (hasStructure ? 'Other lessons' : null);
                  return (
                    <div key={u.key}>
                      {unitName && (
                        <ProgressHeader
                          level={unitLevel}
                          name={unitName}
                          progress={u.unit ? progressByUnit[u.unit.id] : null}
                        />
                      )}
                      <ul
                        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                        role="list"
                        aria-label={group.key === 'start-here' ? 'Start here' : unitName ? `${unitName} lessons` : 'Lessons'}
                      >
                        {u.lessons.map((lesson, i) => (
                          <LessonCardItem
                            key={lesson.lessonId}
                            lesson={lesson}
                            lessonData={lessonData}
                            timeStats={timeStats}
                            navigate={navigate}
                            setDetailLesson={setDetailLesson}
                            animationDelay={i * 30}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
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
          onOpenWork={() => navigate(`/lessons/${detailLesson.lessonId}?view=work`)}
        />
      )}
    </div>
  );
}

// Course (level 2, with a progress bar) or unit (level 3, count only)
// header: completed / total lessons, the learner's own custom-* lessons
// excluded. Units outside a course render at level 2 without a bar.
function ProgressHeader({ id, level, name, progress }) {
  const Heading = `h${level}`;
  const isCourse = level === 2 && !!id;
  const { completed = 0, total = 0 } = progress || {};
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={isCourse ? 'mb-1' : 'mb-3'}>
      <div className={`flex items-baseline justify-between gap-3 ${isCourse ? 'mb-2' : ''}`}>
        <Heading
          id={id}
          className={isCourse
            ? 'text-base font-semibold'
            : 'text-sm font-semibold uppercase tracking-wider text-muted-foreground'}
        >
          {name}
        </Heading>
        {total > 0 && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {completed} of {total} lesson{total === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {isCourse && total > 0 && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`${name} progress: ${completed} of ${total} lessons completed`}
          className="h-1.5 rounded-full bg-muted overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Wrapper for individual lesson cards in the grid. Extracted to avoid
// duplicating the card rendering logic across course and unit groups.
function LessonCardItem({ lesson, lessonData, timeStats, navigate, setDetailLesson, animationDelay }) {
  return (
    <li
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both list-none"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <LessonCard
        lesson={lesson}
        progress={lessonData[lesson.lessonId]}
        timeStats={timeStats[lesson.lessonId]}
        onOpen={() => navigate(`/lessons/${lesson.lessonId}`)}
        onShowOverview={() => setDetailLesson(lesson)}
      />
    </li>
  );
}

function LessonCard({ lesson, progress, timeStats, onOpen, onShowOverview }) {
  // Stable id per card so the open-lesson button can describe itself with
  // the meta strip — Tab navigation announces unit + time as
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
  if (lesson.unit?.name) {
    parts.push({ key: 'unit', text: lesson.unit.name });
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
      title: `Active coaching time based on the middle 60% of ${timeStats.sampleSize} ${completionWord}. Does not include time for research, screenshots, or off-platform work.`,
    });
  }

  const statusText = statusAnnouncement(progress);

  return (
    <Card className="h-full transition-shadow hover:shadow-md group gap-0 p-0">
      <button
        type="button"
        onClick={onOpen}
        // The accessible name comes from the visible content (title +
        // description) so it contains the visible label (WCAG 2.5.3); the
        // sr-only text adds the action and the status, whose visual
        // indicator is aria-hidden.
        aria-describedby={parts.length > 0 ? metaId : undefined}
        className="flex-1 text-left px-4 pt-4 pb-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className="text-base font-semibold leading-snug transition-colors group-hover:text-primary block">
              <span className="sr-only">Open lesson </span>{lesson.name}
            </span>
            {lesson.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                {lesson.description}
              </p>
            )}
          </div>
          <StatusIndicator progress={progress} statusText={statusText} />
        </div>
        <span className="sr-only">. {statusText}.</span>
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
        {/* "View outline" button makes objectives discoverable without
            hunting for an icon. Small, secondary styling so it doesn't
            compete with the primary "Open lesson" affordance. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-xs shrink-0"
          onClick={onShowOverview}
        >
          View outline
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

function LessonDetailDialog({ lesson, progress, timeStats, open, onOpenChange, onOpenWork }) {
  const pct = progress?.status === 'completed' ? 100 : (progress?.progress != null ? progress.progress * 10 : null);
  const progressText = progress?.status === 'completed' ? 'Completed' : (pct != null ? `${pct}% complete` : null);
  const range = timeStats && (timeStats.sampleSize ?? 0) >= 3
    ? formatTimeRange(timeStats.p20, timeStats.p80)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* Course › Unit tag above the title: establishes scope before
              the learner reads the title. */}
          {lesson.unit?.name && (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {lesson.program?.name ? `${lesson.program.name} › ${lesson.unit.name}` : lesson.unit.name}
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
                Most learners finish in {range} of active coaching, based on {timeStats.sampleSize} learner completion{timeStats.sampleSize === 1 ? '' : 's'}. This does not include time for research, screenshots, or off-platform work.
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
          {/* Started lessons: jump to the lesson's work view (#438). */}
          {progress?.status && <Button variant="outline" onClick={onOpenWork}>Your work</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
