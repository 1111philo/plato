/**
 * The Trace (#595): what plato did behind a conversation, in plain words,
 * with the exact text behind each step one click away. The same content is
 * shown docked beside the chat on wide screens and in a dialog on narrow ones
 * (LessonTrace.jsx).
 *
 * `view` is lib/traceView.js describeTrace(...). Exact text is always in a
 * <pre>, never rendered as markdown: it includes model output and text from
 * web pages a learner attached.
 */
import { useEffect, useRef, useState } from 'react';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

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

const summaryClass = 'cursor-pointer select-none rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';
const preClass = 'mt-1 whitespace-pre-wrap break-words rounded-sm bg-muted p-2 text-xs leading-relaxed';

function Exact({ label, note, text }) {
  return (
    <details>
      <summary className={summaryClass}>{label}</summary>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <pre className={preClass}>{text}</pre>
    </details>
  );
}

function Step({ step }) {
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-sm font-medium">{step.title}</h4>
        <Source source={step.source} label={step.sourceLabel} />
      </div>
      <p className="text-sm">{step.summary}</p>
      {step.rules.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {step.rules.map((r) => <li key={r.id}><span className="font-medium">Rule:</span> {r.text}</li>)}
        </ul>
      )}
      {step.change && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div><p className="text-xs font-medium">Before</p><pre className={preClass}>{step.change.before}</pre></div>
          <div><p className="text-xs font-medium">After</p><pre className={preClass}>{step.change.after}</pre></div>
        </div>
      )}
      {step.means && <p className="text-xs text-muted-foreground">{step.means}</p>}
      {step.details.map((d, i) => <Exact key={i} {...d} />)}
    </li>
  );
}

function when(at) {
  try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

function Turn({ turn, open, onToggle, headingRef }) {
  const id = `trace-turn-${turn.id}`;
  return (
    <li className="rounded-md border border-border bg-background p-3 space-y-2">
      <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
        {turn.title} <span className="font-normal text-muted-foreground">· {when(turn.at)}</span>
      </h3>
      <p className="text-sm">
        <Source source={turn.verdict.source} label={turn.verdict.sourceLabel} /> {turn.verdict.text}
      </p>
      {turn.flags.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {turn.flags.map((f) => <li key={f.id}>{f.text}</li>)}
        </ul>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <ChevronRight aria-hidden="true" className={`size-3 motion-safe:transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? 'Hide' : 'Show'} all {turn.steps.length} steps
      </button>
      {/* Steps render only while open: a long lesson has hundreds. */}
      <div id={id} hidden={!open}>
        {open && <ol className="space-y-4 border-l-2 border-muted pl-3">{turn.steps.map((s) => <Step key={s.n} step={s} />)}</ol>}
      </div>
    </li>
  );
}

/**
 * @param {object} p
 * @param {object} p.view      describeTrace(...) result
 * @param {boolean} p.loading
 * @param {string[]} p.live    titles of steps of a turn happening now
 * @param {number} [p.focusAt] a message's timestamp: open and focus the turn that produced it
 * @param {object} [p.stamp]   lessonKB.trace
 * @param {boolean} [p.recording] Trace mode is on for this person now
 */
export default function TraceTimeline({ view, loading, live = [], focusAt, stamp, recording }) {
  const [open, setOpen] = useState(() => new Set());
  const headings = useRef(new Map());
  const turns = view?.turns || [];

  const show = (id) => {
    setOpen((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => headings.current.get(id)?.focus());
  };

  // "Open the trace for this reply": the turn recorded just before that message.
  useEffect(() => {
    if (!focusAt || !turns.length) return undefined;
    const target = [...turns].reverse().find((t) => t.kind !== 'followup' && t.at <= focusAt) || turns[0];
    const id = requestAnimationFrame(() => show(target.id));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt, turns.length]);

  const flags = view?.flags || [];
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Everything plato did behind this conversation. Each step says who decided it: the AI model, plato’s instructions, plato’s code, or a person.
      </p>
      {stamp?.partial && <p>Recording began partway through this lesson. Earlier messages weren’t recorded.</p>}
      {stamp?.full && <p>This trace is full. Later messages weren’t recorded.</p>}
      {stamp && !recording && !stamp.full && <p>Trace mode is off now, so new messages aren’t recorded.</p>}

      {flags.length > 0 && (
        <section aria-labelledby="trace-flags" className="space-y-2">
          <h3 id="trace-flags" className="font-semibold">Things worth a look</h3>
          <ul className="space-y-1">
            {flags.map((f, i) => (
              <li key={i}>
                <button type="button" className="rounded-sm text-left text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => show(f.turn)}>
                  {f.text}
                </button>
                <span className="text-muted-foreground"> · {f.turnTitle}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {live.length > 0 && (
        <section aria-labelledby="trace-live" className="space-y-1">
          <h3 id="trace-live" className="font-semibold">Happening now</h3>
          <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
            {live.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </section>
      )}

      <section aria-labelledby="trace-timeline" className="space-y-2">
        <h3 id="trace-timeline" className="font-semibold">Timeline</h3>
        {loading && !turns.length && <p className="text-muted-foreground" role="status">Loading…</p>}
        {!loading && !turns.length && <p className="text-muted-foreground">Nothing recorded yet.</p>}
        <ol className="space-y-3">
          {turns.map((t) => (
            <Turn
              key={t.id}
              turn={t}
              open={open.has(t.id)}
              onToggle={() => setOpen((prev) => { const next = new Set(prev); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next; })}
              headingRef={(el) => { if (el) headings.current.set(t.id, el); else headings.current.delete(t.id); }}
            />
          ))}
        </ol>
      </section>

      <p className="text-xs text-muted-foreground">
        A trace is recorded by your browser and saved with your lesson. It explains what happened; it isn’t tamper-proof evidence.
      </p>
    </div>
  );
}
