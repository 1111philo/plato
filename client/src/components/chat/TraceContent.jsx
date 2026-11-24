/**
 * The Trace for one conversation (#595): start and stop at the top, then what
 * happened, the technology used, and downloads. Shown in the lesson panel's
 * Trace tab (LessonPanel.jsx) and in Settings → Learner Profile's Trace dialog
 * (TraceButton.jsx).
 *
 * Reads the stored trace (storage.listTraceRecords) and listens to the turn
 * in progress (traceSession.subscribeTrace) while `active`. Screen readers
 * hear one polite "Trace updated" when a turn's trace is saved, not every step.
 */
import { useCallback, useEffect, useState } from 'react';
import { listTraceRecords } from '../../../js/storage.js';
import { describeTrace, technologyFor, traceToText } from '../../lib/traceView.js';
import { authenticatedFetch } from '../../../js/auth.js';
import { subscribeTrace } from '../../lib/traceSession.js';
import { STEPS, AGENTS } from '../../lib/transparency.js';
import TraceTimeline from './TraceTimeline.jsx';
import TraceTechnology from './TraceTechnology.jsx';
import TraceRecordingDot from './TraceRecordingDot.jsx';
import { Button } from '@/components/ui/button';

const liveTitle = (step) => (step.type === 'call' ? `${AGENTS[step.agent]?.label || step.agent}${step.purpose ? `: ${step.purpose}` : ''}` : STEPS[step.type]?.title || step.type);
const linkButton = 'rounded-sm text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:text-muted-foreground disabled:no-underline';
const summaryClass = 'cursor-pointer select-none text-sm font-medium rounded-sm focus-visible:outline-2 focus-visible:outline-ring';

/** Start or stop recording, with what it does. */
function Recorder({ recording, onStart, onStop, error, what }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {recording
          ? <span className="text-xs"><TraceRecordingDot withText /><span className="sr-only">Recording</span></span>
          : <span className="text-muted-foreground">Not recording</span>}
        <Button variant="outline" size="sm" className="ml-auto" onClick={recording ? onStop : onStart}>
          {recording ? 'Stop trace' : 'Start trace'}
        </Button>
      </div>
      {!recording && (
        <p className="text-xs text-muted-foreground">
          Records every step behind {what} from your next message: what was sent to the AI model, what came back, and what plato’s code did with it.
        </p>
      )}
      {error && <p className="text-xs text-red-800 dark:text-red-300" role="alert">{error}</p>}
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.scope       a lesson id, or 'profile'
 * @param {boolean} p.active     shown now: load and listen
 * @param {boolean} p.recording
 * @param {function} p.onStart
 * @param {function} p.onStop
 * @param {string} [p.error]     a failed start or stop
 * @param {string} p.what        "this lesson", "your profile"
 * @param {number} [p.focusAt]   a message's timestamp: open the exchange that produced it
 * @param {object} [p.stamp]     lessonKB.trace
 * @param {string} [p.title]     for the downloaded text
 */
export default function TraceContent({ scope, active, recording, onStart, onStop, error, what, focusAt, stamp, title }) {
  const [view, setView] = useState(null);
  const [items, setItems] = useState([]);
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState([]);
  const [announce, setAnnounce] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const records = await listTraceRecords(scope);
      setItems(records);
      setView(describeTrace(records));
    } finally { setLoading(false); }
  }, [scope]);

  // After the commit, not during it: the load sets state.
  useEffect(() => {
    if (!active) return undefined;
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [active, load]);

  // Which plugins this classroom has turned on, for the technology section.
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    authenticatedFetch('/v1/plugins').then((r) => (r.ok ? r.json() : [])).then((list) => {
      if (!cancelled) setPlugins((Array.isArray(list) ? list : []).filter((p) => p.enabled).map((p) => p.id));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [active]);

  // The turn in progress: its steps as they happen, then the stored trace again.
  useEffect(() => {
    if (!active) return undefined;
    let clear;
    const off = subscribeTrace(scope, (event) => {
      if (event.started && event.kind !== 'followup') setLive([]);
      if (event.step && event.kind !== 'followup') setLive((prev) => [...prev, liveTitle(event.step)]);
      if (event.saved) {
        if (event.kind !== 'followup') setLive([]);
        load();
        setAnnounce('Trace updated');
        clearTimeout(clear);
        clear = setTimeout(() => setAnnounce(''), 3000);
      }
    });
    return () => { off(); clearTimeout(clear); };
  }, [active, scope, load]);

  const download = (kind) => {
    const blob = kind === 'json'
      ? new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
      : new Blob([traceToText(view, { title: `plato trace: ${title || scope}` })], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plato-trace-${scope}.${kind === 'json' ? 'json' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasAny = !!view?.exchanges.length;
  return (
    <div className="space-y-4">
      <Recorder recording={recording} onStart={onStart} onStop={onStop} error={error} what={what} />
      {(recording || hasAny || loading) && (
        <TraceTimeline view={view} loading={loading} live={live} focusAt={focusAt} stamp={stamp} recording={recording} />
      )}
      <details className="rounded-md border border-border bg-background px-3 py-2">
        <summary className={summaryClass}>Technology and services</summary>
        <div className="mt-2"><TraceTechnology services={technologyFor(items, { plugins })} /></div>
      </details>
      {hasAny && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <button type="button" className={linkButton} onClick={() => download('text')}>Download as text</button>
          <button type="button" className={linkButton} onClick={() => download('json')}>Download the data (JSON)</button>
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}
