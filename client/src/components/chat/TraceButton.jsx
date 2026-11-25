/**
 * The Trace for Settings → Learner Profile (#595, scope `profile`): a button
 * that opens it as a dialog, where the learner starts and stops recording
 * (TraceContent.jsx). While it records, the button says so.
 */
import { useEffect, useRef, useState } from 'react';
import Footprints from 'lucide-react/dist/esm/icons/footprints';
import useTraceSwitch from '../../hooks/useTraceSwitch.js';
import TraceContent from './TraceContent.jsx';
import TraceRecordingDot from './TraceRecordingDot.jsx';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function TraceButton({ scope, what, size = 'sm', className }) {
  const { on, set, error } = useTraceSwitch(scope);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const titleRef = useRef(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => buttonRef.current?.focus()); };

  // Focus the title on open (two frames: the dialog focuses its close button first).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) titleRef.current?.focus(); }));
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [open]);

  return (
    <>
      <Button ref={buttonRef} variant="outline" size={size} className={className}
        aria-label={`Data Trace for ${what}${on ? ' (recording)' : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Footprints aria-hidden="true" className="size-4" />
        Data Trace
        {on && <TraceRecordingDot withText />}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col bg-stone-50 dark:bg-stone-950">
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1}>Data Trace</DialogTitle>
              <DialogDescription>What plato does behind {what}.</DialogDescription>
            </DialogHeader>
            <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-2 rounded-sm focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Trace steps">
              <TraceContent scope={scope} active recording={on} onStart={() => set(true)} onStop={() => set(false)} error={error} what={what} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
