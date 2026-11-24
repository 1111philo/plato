/**
 * The Trace button for Settings → Learner Profile (#595, scope `profile`).
 * Pressing it starts recording changes to the profile, if it wasn't already,
 * and opens the Trace as a dialog; "Stop tracing" there ends it. While it
 * records, the button says so.
 */
import { useRef, useState } from 'react';
import Footprints from 'lucide-react/dist/esm/icons/footprints';
import useTraceSwitch from '../../hooks/useTraceSwitch.js';
import LessonTrace from './LessonTrace.jsx';
import { Button } from '@/components/ui/button';
import TraceRecordingDot from './TraceRecordingDot.jsx';

export default function TraceButton({ scope, what, size = 'sm', className }) {
  const { on, set, error } = useTraceSwitch(scope);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => buttonRef.current?.focus()); };

  return (
    <>
      <Button ref={buttonRef} variant="outline" size={size} className={className}
        aria-label={on ? `Trace for ${what} (recording)` : `Start Trace for ${what}`} aria-haspopup="dialog"
        onClick={() => { if (!on) set(true); setOpen(true); }}>
        <Footprints aria-hidden="true" className="size-4" />
        Trace
        {on && <TraceRecordingDot withText />}
      </Button>
      <LessonTrace scope={scope} open={open} docked={false} recording={on} error={error}
        onStop={() => { set(false); close(); }} onClose={close} />
    </>
  );
}
