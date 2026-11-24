/**
 * The Trace for one conversation (#595), opened from the lesson header.
 *
 * Its switch, at the top, turns recording on or off for this conversation
 * only (hooks/useTraceSwitch.js); absent while viewing as a learner.
 *
 * Wide screens: docked beside the chat (`docked`), so a person can watch the
 * steps of a reply appear while they keep chatting. It is a complementary
 * landmark, not a modal: no focus trap; Escape closes it when focus is
 * inside. Narrow screens: a dialog, like the lesson overview.
 *
 * Reads the stored trace (storage.listTraceRecords, which in View as User
 * reads the learner's), and listens to the turn in progress
 * (traceSession.subscribeTrace). Screen readers hear one polite "Trace
 * updated" when a turn's trace is saved, not every step.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import { listTraceRecords } from '../../../js/storage.js';
import { describeTrace, technologyFor, traceToText } from '../../lib/traceView.js';
import { authenticatedFetch } from '../../../js/auth.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { subscribeTrace } from '../../lib/traceSession.js';
import { STEPS, AGENTS } from '../../lib/transparency.js';
import TraceTimeline from './TraceTimeline.jsx';
import TraceTechnology from './TraceTechnology.jsx';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const liveTitle = (step) => (step.type === 'call' ? `${AGENTS[step.agent]?.label || step.agent}${step.purpose ? `: ${step.purpose}` : ''}` : STEPS[step.type]?.title || step.type);

/** Record this conversation, or not. Shown at the top of the Trace. */
function TraceSwitch({ control, label, hint }) {
  if (!control || control.readOnly) return null;
  const id = 'trace-switch-help';
  return (
    <div className="space-y-1 rounded-md border border-border bg-background p-2 text-sm">
      <label className="flex items-start gap-2 font-medium">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={control.on} disabled={control.byTeam}
          aria-describedby={id} onChange={(e) => control.set(e.target.checked)} />
        <span>{label}</span>
      </label>
      <p id={id} className="text-xs text-muted-foreground">
        {control.byTeam
          ? 'Turned on by your classroom team, for everything you do.'
          : control.on
            ? (hint || 'Recording from your next message.')
            : 'Off. Turn it on to record what plato does from your next message.'}
        {' '}Your classroom team can read it too.
      </p>
      {control.error && <p className="text-xs text-red-800 dark:text-red-300" role="alert">{control.error}</p>}
    </div>
  );
}

export default function LessonTrace({ scope, open, onClose, docked, focusAt, stamp, recording, frame, title, control, switchLabel = 'Record this conversation', hint }) {
  const [view, setView] = useState(null);
  const [items, setItems] = useState([]);
  const [plugins, setPlugins] = useState([]);
  const [tab, setTab] = useState('timeline');
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState([]);
  const [announce, setAnnounce] = useState('');
  const titleRef = useRef(null);
  const asideRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const records = await listTraceRecords(scope);
      setItems(records);
      setView(describeTrace(records));
    } finally { setLoading(false); }
  }, [scope]);

  // Which plugins this classroom has turned on, for the Technology tab.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    authenticatedFetch('/v1/plugins').then((r) => (r.ok ? r.json() : [])).then((list) => {
      if (!cancelled) setPlugins((Array.isArray(list) ? list : []).filter((p) => p.enabled).map((p) => p.id));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // "Open the trace for this reply" always lands on the timeline.
  useEffect(() => { if (focusAt) requestAnimationFrame(() => setTab('timeline')); }, [focusAt]);

  const download = (kind) => {
    const name = `plato-trace-${scope}`;
    const blob = kind === 'json'
      ? new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
      : new Blob([traceToText(view, { title: `plato trace: ${title || scope}` })], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${kind === 'json' ? 'json' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // After the commit, not during it: the load sets state.
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [open, load]);

  // The turn in progress: its steps as they happen, then the stored trace again.
  useEffect(() => {
    if (!open) return undefined;
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
  }, [open, scope, load]);

  // Move focus to the title on open (two frames: the dialog focuses its close button first).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) titleRef.current?.focus(); }));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [open, docked]);

  if (!open) return null;
  const linkButton = 'rounded-sm text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:text-muted-foreground disabled:no-underline';
  const body = (
    <>
      {/* Docked, the top padding is inside the scrolled content, so the exchange
          bar can stick flush to the top. */}
      <div className={docked ? 'pt-4' : undefined}><TraceSwitch control={control} label={switchLabel} hint={hint} /></div>
      <Tabs value={tab} onValueChange={setTab} className="pt-3">
        <TabsList className="mb-3" aria-label="Trace sections">
          <TabsTrigger value="timeline">What happened</TabsTrigger>
          <TabsTrigger value="technology">Technology and services</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <TraceTimeline view={view} loading={loading} live={live} focusAt={focusAt} stamp={stamp} recording={recording} />
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" className={linkButton} disabled={!view?.exchanges.length} onClick={() => download('text')}>Download as text</button>
            <button type="button" className={linkButton} disabled={!view?.exchanges.length} onClick={() => download('json')}>Download the data (JSON)</button>
          </p>
        </TabsContent>
        <TabsContent value="technology">
          <TraceTechnology services={technologyFor(items, { plugins })} />
        </TabsContent>
      </Tabs>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </>
  );

  if (docked) {
    return (
      <aside
        ref={asideRef}
        id="lesson-trace"
        aria-labelledby="lesson-trace-title"
        className="fixed right-0 z-40 flex w-[26rem] flex-col border-l border-border bg-stone-50 dark:bg-stone-950"
        style={frame}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 id="lesson-trace-title" ref={titleRef} tabIndex={-1} className="text-sm font-semibold rounded-sm focus-visible:outline-2 focus-visible:outline-ring">Trace</h2>
          <Button variant="ghost" size="icon-sm" aria-label="Close trace" onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 rounded-sm focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Trace steps">
          {body}
        </div>
      </aside>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent id="lesson-trace" className="sm:max-w-2xl max-h-[85vh] flex flex-col bg-stone-50 dark:bg-stone-950">
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>Trace</DialogTitle>
          <DialogDescription>What plato did behind this conversation.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 overflow-y-auto overflow-x-hidden flex-1 pr-2 rounded-sm focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Trace steps">
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}
