/**
 * The Trace (#595), conversation first: a list of the exchanges, and one
 * exchange at a time, step by step in plain stages ("You sent" → "plato
 * prepared…" → "The AI model answered" → "plato checked the answer" →
 * "plato recorded the result" → "In the background"). Shown docked beside
 * the chat or in a dialog (LessonTrace.jsx).
 *
 * `view` is lib/traceView.js describeTrace(...). Exact text is always in a
 * <pre>, never rendered as markdown: it includes model output and text from
 * web pages a learner attached.
 */
import { useEffect, useRef, useState } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert';
import { Button } from '@/components/ui/button';

const SOURCE_STYLE = {
  model: 'border-sky-700 text-sky-900 dark:border-sky-400 dark:text-sky-200',
  instructions: 'border-violet-700 text-violet-900 dark:border-violet-400 dark:text-violet-200',
  code: 'border-amber-700 text-amber-900 dark:border-amber-400 dark:text-amber-200',
  person: 'border-emerald-700 text-emerald-900 dark:border-emerald-400 dark:text-emerald-200',
};

/** Who decided: always text, with a border colour as a second cue. */
function Source({ source, label }) {
  return <span className={`inline-block shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.6875rem] leading-none font-medium ${SOURCE_STYLE[source] || ''}`}>{label}</span>;
}

const focusRing = 'rounded-sm focus-visible:outline-2 focus-visible:outline-ring';
const summaryClass = `cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground ${focusRing}`;
const preClass = 'mt-1 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] rounded-sm bg-muted p-2 text-xs leading-relaxed';
const quoteClass = 'mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border-l-4 bg-background p-2 text-sm';

function when(at) {
  try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

/** The exact text behind a step, behind one disclosure. */
function ExactText({ details }) {
  if (!details.length) return null;
  return (
    <details className="mt-1">
      <summary className={summaryClass}>Show the exact text ({details.length})</summary>
      <div className="mt-1 space-y-2 border-l-2 border-muted pl-2">
        {details.map((d, i) => (
          <details key={i}>
            <summary className={summaryClass}>{d.label}</summary>
            {d.note && <p className="mt-1 text-xs text-muted-foreground">{d.note}</p>}
            <pre className={preClass}>{d.text}</pre>
          </details>
        ))}
      </div>
    </details>
  );
}

function Step({ step }) {
  return (
    <li className="space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{step.title}</span>
        <Source source={step.source} label={step.sourceLabel} />
      </p>
      <p>{step.summary}</p>
      {step.rules.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {step.rules.map((r) => <li key={r.id}><span className="font-medium">Rule:</span> {r.text}</li>)}
        </ul>
      )}
      {step.change && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Before</p><pre className={preClass}>{step.change.before}</pre>
          <p className="text-xs font-medium">After</p><pre className={preClass}>{step.change.after}</pre>
        </div>
      )}
      <ExactText details={step.details} />
    </li>
  );
}

const stageId = (e, st) => `trace-x-${e.id}-${st.id}`;

function Stage({ stage, n, id }) {
  return (
    <li className="space-y-2">
      <h5 id={id} tabIndex={-1} className={`scroll-mt-14 font-semibold ${focusRing}`}>{n}. {stage.title}</h5>
      <ul className="space-y-3 border-l-2 border-muted pl-3">
        {stage.steps.map((s) => <Step key={s.n} step={s} />)}
        {(stage.followups || []).map((f, i) => (
          <li key={`f${i}`} className="space-y-2">
            <p><span className="font-medium">{f.title}</span>{f.why ? ` ran because ${f.why}.` : ''}{f.failed ? ' It failed.' : ''}</p>
            <ul className="space-y-3 border-l-2 border-muted pl-3">{f.steps.map((s) => <Step key={s.n} step={s} />)}</ul>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Exchange({ exchange: e, total, onBack, onPrev, onNext, headingRef }) {
  return (
    <article className="space-y-4" aria-labelledby={`trace-x-${e.id}`}>
      {/* Stays at the top of the panel while an exchange scrolls. */}
      <nav aria-label="Exchanges" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-stone-50 py-2 dark:bg-stone-950">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft aria-hidden="true" className="size-4" /> All exchanges
        </Button>
        <span className="ml-auto" />
        <Button variant="ghost" size="sm" onClick={onPrev} disabled={!onPrev} aria-label="Previous exchange">
          <ChevronLeft aria-hidden="true" className="size-4" /> Previous
        </Button>
        <Button variant="ghost" size="sm" onClick={onNext} disabled={!onNext} aria-label="Next exchange">
          Next <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </nav>

      <h3 id={`trace-x-${e.id}`} ref={headingRef} tabIndex={-1} className={`scroll-mt-14 text-base font-semibold ${focusRing}`}>
        {e.kind === 'start' ? 'Lesson start' : `Exchange ${e.n} of ${total}`} <span className="font-normal text-muted-foreground">· {when(e.at)}</span>
      </h3>
      {e.kind !== 'turn' && e.kind !== 'start' && <p className="-mt-3">{e.title}</p>}

      {e.you != null && e.you !== '' && (
        <div><p className="text-xs font-medium">You sent</p><blockquote className={`${quoteClass} border-primary`}>{e.you}</blockquote></div>
      )}
      {e.saw != null && e.saw !== '' && (
        <div>
          <p className="text-xs font-medium">You saw</p>
          <blockquote className={`${quoteClass} border-muted-foreground`}>{e.saw}</blockquote>
          {e.firstSeen && (
            <details className="mt-1">
              <summary className={summaryClass}>A different reply appeared first, then plato replaced it</summary>
              <pre className={preClass}>{e.firstSeen}</pre>
            </details>
          )}
        </div>
      )}

      <p className="flex flex-wrap items-baseline gap-2">
        <Source source={e.verdict.source} label={e.verdict.sourceLabel} />
        <span>{e.verdict.text}</span>
      </p>

      {e.flags.length > 0 && (
        <div className="rounded-md border border-amber-700 bg-amber-50 p-2 dark:border-amber-400 dark:bg-amber-950">
          <p className="flex items-center gap-1 font-medium"><TriangleAlert aria-hidden="true" className="size-4" /> Worth a look</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{e.flags.map((f) => <li key={f.id}>{f.text}</li>)}</ul>
        </div>
      )}

      <section aria-labelledby={`trace-x-${e.id}-steps`} className="space-y-3">
        <h4 id={`trace-x-${e.id}-steps`} className="font-semibold">What happened, in order</h4>
        <p className="text-xs">
          <span className="text-muted-foreground">Jump to: </span>
          {e.stages.map((st, i) => (
            <span key={st.id}>
              {i > 0 && <span aria-hidden="true" className="text-muted-foreground"> · </span>}
              <a href={`#${stageId(e, st)}`} className={`text-primary hover:underline ${focusRing}`}
                onClick={(ev) => { ev.preventDefault(); const el = document.getElementById(stageId(e, st)); el?.scrollIntoView({ block: 'start' }); el?.focus({ preventScroll: true }); }}>
                {i + 1}. {st.title}
              </a>
            </span>
          ))}
        </p>
        <ol className="space-y-4">{e.stages.map((st, i) => <Stage key={st.id} stage={st} n={i + 1} id={stageId(e, st)} />)}</ol>
      </section>
    </article>
  );
}

function Row({ exchange: e, onOpen, buttonRef }) {
  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        className={`w-full rounded-md border border-border bg-background p-2 text-left hover:bg-muted ${focusRing}`}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{e.n}. {e.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{when(e.at)}</span>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {[e.headline, e.verdict.short].filter(Boolean).join(' · ')}
        </span>
        {e.flags.length > 0 && (
          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-900 dark:text-amber-200">
            <TriangleAlert aria-hidden="true" className="size-3.5" /> {e.flags.length} worth a look
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * @param {object} p
 * @param {object} p.view      describeTrace(...) result
 * @param {boolean} p.loading
 * @param {string[]} p.live    titles of steps of an exchange happening now
 * @param {number} [p.focusAt] a message's timestamp: open the exchange that produced it
 * @param {object} [p.stamp]   lessonKB.trace
 * @param {boolean} [p.recording] Trace mode is on for this person now
 */
export default function TraceTimeline({ view, loading, live = [], focusAt, stamp, recording }) {
  const [openId, setOpenId] = useState(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const heading = useRef(null);
  const rows = useRef(new Map());
  const exchanges = view?.exchanges || [];
  const index = exchanges.findIndex((x) => x.id === openId);
  const open = index >= 0 ? exchanges[index] : null;

  // Where focus goes after the view changes: the exchange's heading, or the
  // row of the exchange just left. Two frames, after the view has rendered:
  // the row clicked has gone, and a dialog's own focus handling reacts first.
  const [focusTarget, setFocusTarget] = useState(null);
  useEffect(() => {
    if (!focusTarget) return undefined;
    let cancelled = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      if (focusTarget.kind === 'heading') {
        heading.current?.closest('[role=region]')?.scrollTo?.({ top: 0 });
        heading.current?.focus({ preventScroll: true });
      } else {
        rows.current.get(focusTarget.id)?.focus();
      }
    }));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [focusTarget]);
  const show = (id) => { setOpenId(id); setFocusTarget({ kind: 'heading', id, at: Date.now() }); };
  const back = () => { const id = openId; setOpenId(null); setFocusTarget({ kind: 'row', id, at: Date.now() }); };

  // "Open the trace for this reply": the exchange recorded just before that message.
  useEffect(() => {
    if (!focusAt || !exchanges.length) return undefined;
    const target = [...exchanges].reverse().find((x) => x.at <= focusAt) || exchanges[0];
    const id = requestAnimationFrame(() => show(target.id));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt, exchanges.length]);

  if (open) {
    return (
      <Exchange
        exchange={open}
        total={exchanges.length}
        headingRef={heading}
        onBack={back}
        onPrev={index > 0 ? () => show(exchanges[index - 1].id) : null}
        onNext={index < exchanges.length - 1 ? () => show(exchanges[index + 1].id) : null}
      />
    );
  }

  const listed = onlyFlagged ? exchanges.filter((x) => x.flags.length) : exchanges;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Every exchange in this conversation. Open one to see, step by step, what was sent to the AI model, what came back, and what plato’s code did with it.
      </p>
      {stamp?.partial && <p>Recording began partway through this lesson. Earlier messages weren’t recorded.</p>}
      {stamp?.full && <p>This trace is full. Later messages weren’t recorded.</p>}
      {stamp && !recording && !stamp.full && <p>Trace mode is off now, so new messages aren’t recorded.</p>}

      {live.length > 0 && (
        <section aria-labelledby="trace-live" className="rounded-md border border-border p-2">
          <h3 id="trace-live" className="font-semibold">Happening now</h3>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            {live.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </section>
      )}

      <section aria-labelledby="trace-exchanges" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="trace-exchanges" className="font-semibold">Exchanges{exchanges.length ? ` (${exchanges.length})` : ''}</h3>
          {view?.flagged > 0 && (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" className="accent-primary" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
              Only the {view.flagged} worth a look
            </label>
          )}
        </div>
        {loading && !exchanges.length && <p className="text-muted-foreground" role="status">Loading…</p>}
        {!loading && !exchanges.length && <p className="text-muted-foreground">Nothing recorded yet.</p>}
        <ol className="space-y-2">
          {listed.map((x) => (
            <Row key={x.id} exchange={x} onOpen={() => show(x.id)}
              buttonRef={(el) => { if (el) rows.current.set(x.id, el); else rows.current.delete(x.id); }} />
          ))}
        </ol>
      </section>

      <p className="text-xs text-muted-foreground">
        A trace is recorded by your browser and saved with your lesson. It explains what happened; it isn’t tamper-proof evidence.
      </p>
    </div>
  );
}
