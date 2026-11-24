/**
 * The Trace (#595), conversation first: a list of the exchanges with what
 * plato did across all of them, and one exchange at a time.
 *
 * An exchange reads top to bottom: what you sent and saw, who decided, where
 * plato stepped in (only when it did), then "Every step", folded away, in
 * stages. A repeat reader sees what happened; a first-time reader opens "ⓘ"
 * for what each part means. Shown in the lesson panel's Trace tab
 * (TraceContent.jsx).
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
import { SOURCES } from '../../lib/transparency.js';
import Explain from './Explain.jsx';

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
// Sentence case, but "plato" stays lowercase (the brand).
const capital = (t) => (!t || /^plato/.test(t) ? t : t[0].toUpperCase() + t.slice(1));

function when(at) {
  try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}
const secs = (ms) => (ms == null ? null : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

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

const NOTE_STYLE = {
  changed: { box: 'border-amber-700 bg-amber-50 dark:border-amber-400 dark:bg-amber-950', label: 'plato stepped in' },
  problem: { box: 'border-red-700 bg-red-50 dark:border-red-400 dark:bg-red-950', label: 'Something went wrong' },
};

function Note({ note }) {
  const style = NOTE_STYLE[note.kind] || NOTE_STYLE.changed;
  return (
    <p className={`flex items-start gap-1.5 rounded-sm border-l-4 px-2 py-1 ${style.box}`}>
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span><span className="font-medium">{style.label}:</span> {note.text}</span>
    </p>
  );
}

const FIELD_NAME = { purpose: 'what the agent is for', runs: 'when it runs', reads: 'what it’s given', returns: 'what it sends back' };

/** Who an agent is, from the header its call recorded. */
function AgentCard({ info }) {
  const rows = [['When it runs', info.runs], ['What it’s given', info.reads?.join('; ')], ['What it sends back', info.returns?.join('; ')]].filter(([, v]) => v);
  return (
    <Explain text label={`Who is the ${info.name}?`}>
      <p>{info.purpose}</p>
      {rows.length > 0 && (
        <dl className="mt-1 space-y-0.5">
          {rows.map(([k, v]) => <div key={k}><dt className="inline font-medium text-foreground">{k}: </dt><dd className="inline">{v}</dd></div>)}
        </dl>
      )}
      <p className="mt-1 italic">
        {info.from === 'file' ? `From the ${info.name}’s prompt file at the time. plato doesn’t send this description to the model.`
          : info.from === 'sent' ? 'From the instructions this call sent.'
            : 'Today’s description: this trace didn’t record one.'}
        {info.from && info.fromToday?.length ? ` It didn’t say ${info.fromToday.map((k) => FIELD_NAME[k]).join(' or ')}; that is today’s description.` : ''}
      </p>
    </Explain>
  );
}

/** One step: a line that opens to what it did and the exact text. */
function Step({ step, id }) {
  return (
    <li id={id}>
      <details>
        <summary className={`cursor-pointer ${focusRing}`}>
          <span className="font-medium">{step.title}</span>{' '}
          <Source source={step.source} label={step.sourceLabel} />
          {step.note && <span className="sr-only"> ({NOTE_STYLE[step.note.kind]?.label})</span>}
          {step.note && <TriangleAlert aria-hidden="true" className="ml-1 inline size-3.5 text-amber-700 dark:text-amber-400" />}
          {step.at != null && <span className="ml-2 text-xs text-muted-foreground">at {secs(step.at)}{step.took != null ? ` · took ${secs(step.took)}` : ''}</span>}
        </summary>
        <div className="mt-1 space-y-1 border-l-2 border-muted pl-2">
          {step.note && <Note note={step.note} />}
          <div className="flex flex-wrap items-start gap-1">
            <p className="min-w-0 flex-1">{step.summary}</p>
            {step.means && <Explain label={`What is this: ${step.title}`}>{step.means}</Explain>}
          </div>
          {step.agentInfo && step.part === 'request' && <div className="flex flex-wrap"><AgentCard info={step.agentInfo} /></div>}
          {step.hint && <p className="text-xs text-muted-foreground">{step.hint}</p>}
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
        </div>
      </details>
    </li>
  );
}

const stepId = (e, n) => `trace-x-${e.id}-step-${n}`;

/** A check: its question and answer in one line; it opens for the steps behind it, and starts open when it found something. */
function Check({ check, e }) {
  const all = [check.answer, ...check.steps];
  return (
    <li>
      <details open={all.some((s) => s.note)}>
        <summary className={`cursor-pointer ${focusRing}`}>
          <span className="font-medium">{check.title}</span>{' '}
          <span className="text-muted-foreground">{check.answer.summary}</span>
        </summary>
        <div className="mt-1 space-y-1 border-l-2 border-muted pl-2">
          {check.means && <p className="text-xs text-muted-foreground">{check.means}</p>}
          <ul className="space-y-2">{all.map((s) => <Step key={s.n} step={s} id={stepId(e, s.n)} />)}</ul>
        </div>
      </details>
    </li>
  );
}

function Stage({ stage, e }) {
  return (
    <li className="space-y-1.5">
      <h5 className="flex flex-wrap items-center gap-1 font-semibold">
        {stage.title}
        {stage.means && <Explain label={`What is this stage: ${stage.title}`}>{stage.means}</Explain>}
      </h5>
      <ul className="space-y-2 border-l-2 border-muted pl-3">
        {stage.checks
          ? stage.checks.map((c) => <Check key={c.id} check={c} e={e} />)
          : stage.steps.map((s) => <Step key={s.n} step={s} id={stepId(e, s.n)} />)}
        {(stage.followups || []).map((f, i) => (
          <li key={`f${i}`} className="space-y-1">
            <p><span className="font-medium">{f.title}</span>{f.why ? ` ran because ${f.why}.` : ''}{f.failed ? ' It failed.' : ''}</p>
            <ul className="space-y-2 border-l-2 border-muted pl-3">{f.steps.map((s) => <Step key={s.n} step={s} id={stepId(e, s.n)} />)}</ul>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Exchange({ exchange: e, total, onBack, onPrev, onNext, headingRef }) {
  const stepsRef = useRef(null);
  // "Show this step": open "Every step", then the step (and any check around
  // it), and take focus there.
  const goTo = (n) => {
    if (stepsRef.current) stepsRef.current.open = true;
    requestAnimationFrame(() => {
      const li = document.getElementById(stepId(e, n));
      if (!li) return;
      for (let d = li.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
      const own = li.querySelector('details');
      if (own) own.open = true;
      li.querySelector('summary')?.focus();
      li.scrollIntoView?.({ block: 'center' });
    });
  };
  const count = e.stages.reduce((n, st) => n + st.steps.length + (st.followups || []).reduce((m, f) => m + f.steps.length, 0), 0);
  return (
    <article className="space-y-3" aria-labelledby={`trace-x-${e.id}`}>
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
        {e.kind === 'start' ? 'Lesson start' : `Exchange ${e.n} of ${total}`}{' '}
        <span className="font-normal text-muted-foreground">· {when(e.at)}{e.took != null ? ` · took ${secs(e.took)} in all` : ''}</span>
      </h3>
      {e.kind !== 'turn' && e.kind !== 'start' && <p className="-mt-2">{e.title}</p>}

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

      <div className="flex flex-wrap items-baseline gap-2">
        <Source source={e.verdict.source} label={e.verdict.sourceLabel} />
        {/* With "Where plato stepped in" below, the verdict's first sentence is enough. */}
        <p className="min-w-0 flex-1">{e.headline ? `${e.headline}. ` : ''}{e.interventions.length ? e.verdict.lead : e.verdict.text}</p>
        <Explain label="What do these labels mean?">
          <ul className="space-y-0.5">{Object.values(SOURCES).map((x) => <li key={x.label}><span className="font-medium text-foreground">{x.label}:</span> {x.means}</li>)}</ul>
        </Explain>
      </div>

      {e.interventions.length > 0 && (
        <section aria-labelledby={`trace-x-${e.id}-in`} className="space-y-1">
          <h4 id={`trace-x-${e.id}-in`} className="font-semibold">Where plato stepped in</h4>
          <ul className="space-y-1">
            {e.interventions.map((x, i) => (
              <li key={i} className={`flex flex-wrap items-baseline gap-x-2 rounded-sm border-l-4 px-2 py-1 ${NOTE_STYLE[x.kind]?.box || ''}`}>
                <span className="sr-only">{NOTE_STYLE[x.kind]?.label}: </span>
                <span className="min-w-0 flex-1">{capital(x.text)}</span>
                <button type="button" className={`text-xs text-primary hover:underline ${focusRing}`} onClick={() => goTo(x.n)}>Show this step</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details ref={stepsRef} className="rounded-md border border-border bg-background px-2 py-1.5">
        <summary className={`cursor-pointer font-semibold ${focusRing}`}>Every step ({count})</summary>
        <p className="mt-1 text-xs text-muted-foreground">Times are counted from when {e.kind === 'start' ? 'the lesson started' : e.kind === 'turn' ? 'you sent the message' : 'this began'}.</p>
        <ol className="mt-2 space-y-4">{e.stages.map((st) => <Stage key={st.id} stage={st} e={e} />)}</ol>
      </details>
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
        {e.wentWrong && (
          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-red-800 dark:text-red-300">
            <TriangleAlert aria-hidden="true" className="size-3.5" /> Something went wrong
          </span>
        )}
      </button>
    </li>
  );
}

/** What plato did across the conversation; each line narrows the list to those exchanges. */
function Summary({ summary, filter, setFilter }) {
  if (!summary?.items?.length) return null;
  return (
    <section aria-labelledby="trace-summary" className="space-y-1">
      <h3 id="trace-summary" className="font-semibold">{summary.exchanges === 1 ? 'In this exchange' : `Across ${summary.exchanges} exchanges`}, plato…</h3>
      <ul className="space-y-1">
        {summary.items.map((it) => (
          <li key={it.id} className="flex items-start gap-2">
            <span aria-hidden="true" className="leading-5">•</span>
            <button type="button" aria-pressed={filter === it.id} onClick={() => setFilter(filter === it.id ? null : it.id)}
              className={`text-left leading-5 hover:underline ${filter === it.id ? 'font-medium text-primary' : ''} ${focusRing}`}>
              {it.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * @param {object} p
 * @param {object} p.view      describeTrace(...) result
 * @param {boolean} p.loading
 * @param {string[]} p.live    titles of steps of an exchange happening now
 * @param {number} [p.focusAt] a message's timestamp: open the exchange that produced it
 * @param {object} [p.stamp]   lessonKB.trace
 * @param {boolean} [p.recording] Trace is recording this conversation now
 * @param {string} [p.scope]   to remember the exchange last open, for the session
 */
export default function TraceTimeline({ view, loading, live = [], focusAt, stamp, recording, scope }) {
  const memory = scope ? `plato-trace-open:${scope}` : null;
  const [openId, setOpenId] = useState(() => {
    try { return memory ? Number(sessionStorage.getItem(memory)) || null : null; } catch { return null; }
  });
  const [filter, setFilter] = useState(null);
  const heading = useRef(null);
  const rows = useRef(new Map());
  const exchanges = view?.exchanges || [];
  const index = exchanges.findIndex((x) => x.id === openId);
  const open = index >= 0 ? exchanges[index] : null;

  useEffect(() => {
    if (!memory) return;
    try { if (openId) sessionStorage.setItem(memory, String(openId)); else sessionStorage.removeItem(memory); } catch { /* storage unavailable */ }
  }, [memory, openId]);

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
        heading.current?.closest('[role=tabpanel],[role=region]')?.scrollTo?.({ top: 0 });
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
        key={open.id}
        exchange={open}
        total={exchanges.length}
        headingRef={heading}
        onBack={back}
        onPrev={index > 0 ? () => show(exchanges[index - 1].id) : null}
        onNext={index < exchanges.length - 1 ? () => show(exchanges[index + 1].id) : null}
      />
    );
  }

  const narrowed = filter ? new Set(view?.summary?.items.find((it) => it.id === filter)?.exchanges || []) : null;
  const listed = narrowed ? exchanges.filter((x) => narrowed.has(x.at)) : exchanges;
  return (
    <div className="space-y-4 text-sm">
      {stamp?.partial && <p>Recording began partway through this lesson. Earlier messages weren’t recorded.</p>}
      {stamp?.full && <p>This trace is full. Later messages weren’t recorded.</p>}
      {stamp && !recording && !stamp.full && <p>Recording is off, so new messages aren’t recorded.</p>}

      {live.length > 0 && (
        <section aria-labelledby="trace-live" className="rounded-md border border-border p-2">
          <h3 id="trace-live" className="font-semibold">Happening now</h3>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            {live.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </section>
      )}

      <Summary summary={view?.summary} filter={filter} setFilter={setFilter} />

      <section aria-labelledby="trace-exchanges" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="trace-exchanges" className="font-semibold">Exchanges{exchanges.length ? ` (${narrowed ? `${listed.length} of ${exchanges.length}` : exchanges.length})` : ''}</h3>
          {filter && <button type="button" className={`text-xs text-primary hover:underline ${focusRing}`} onClick={() => setFilter(null)}>Show all</button>}
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
