/**
 * The lesson panel: one place for everything about a lesson besides the chat,
 * opened from the "Overview (N of M Objectives)" button in the lesson header.
 * Two tabs: Overview (LessonOverview.jsx) and Trace (TraceContent.jsx, #595),
 * where a learner starts and stops recording. Trace is rarely used, so it has
 * no control of its own in the header; a "Recording" marker shows there only
 * while it records.
 *
 * Wide screens (1024 px and up): docked beside the chat, so the learner can
 * keep chatting and watch progress or a trace update. A complementary
 * landmark, not a modal: no focus trap; Escape closes it from inside; focus
 * returns to the button that opened it. Narrow screens: a dialog.
 */
import { useEffect, useRef } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import TraceRecordingDot from './TraceRecordingDot.jsx';

const regionClass = 'min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-ring';

/**
 * @param {object} p
 * @param {boolean} p.open
 * @param {'overview'|'trace'} p.tab
 * @param {function} p.onTabChange
 * @param {function} p.onClose
 * @param {boolean} p.docked
 * @param {object} [p.frame]     `{ top, bottom }` of the space beside the chat, when docked
 * @param {string} p.title       the lesson's name
 * @param {boolean} p.recording
 * @param {function} p.overview  (active) => the Overview tab
 * @param {function} [p.trace]   (active) => the Trace tab; absent: no Trace tab
 */
export default function LessonPanel({ open, tab, onTabChange, onClose, docked, frame, title, recording, overview, trace }) {
  const titleRef = useRef(null);
  const shown = trace ? tab : 'overview';

  // Focus the title on open (two frames: a dialog focuses its close button first).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) titleRef.current?.focus(); }));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [open, docked]);

  if (!open) return null;

  const tabs = (
    <Tabs value={shown} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col">
      {trace && (
        <TabsList className={docked ? 'mx-4 mt-3' : undefined} aria-label="Lesson panel">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trace">
            Trace{recording && <span className="ml-1.5"><TraceRecordingDot /></span>}
            {recording && <span className="sr-only"> (recording)</span>}
          </TabsTrigger>
        </TabsList>
      )}
      {/* Each tab panel scrolls on its own and is focusable, so a keyboard can scroll it (axe scrollable-region-focusable). */}
      <TabsContent value="overview" className={`${regionClass} ${docked ? 'px-4 pb-4' : 'pr-2'}`} tabIndex={0} aria-label={trace ? undefined : 'Overview'}>
        {/* Top padding inside the scrolled content, so a sticky bar can sit flush at the top. */}
        <div className="pt-3">{overview(shown === 'overview')}</div>
      </TabsContent>
      {trace && (
        <TabsContent value="trace" className={`${regionClass} ${docked ? 'px-4 pb-4' : 'pr-2'}`} tabIndex={0}>
          <div className="pt-3">{trace(shown === 'trace')}</div>
        </TabsContent>
      )}
    </Tabs>
  );

  if (docked) {
    return (
      <aside
        id="lesson-panel"
        aria-labelledby="lesson-panel-title"
        className="fixed right-0 z-40 flex w-[26rem] flex-col border-l border-border bg-stone-50 dark:bg-stone-950"
        style={frame}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h2 id="lesson-panel-title" ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 truncate text-sm font-semibold rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{title}</h2>
          <Button variant="ghost" size="icon-sm" aria-label="Close lesson panel" onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
        {tabs}
      </aside>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent id="lesson-panel" className="sm:max-w-2xl max-h-[85vh] flex flex-col bg-stone-50 dark:bg-stone-950">
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>{title}</DialogTitle>
        </DialogHeader>
        {tabs}
      </DialogContent>
    </Dialog>
  );
}
