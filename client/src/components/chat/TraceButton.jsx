/**
 * A "Trace" button for the places outside a lesson that Trace records
 * (#595): Settings → Learner Profile (scope `profile`), the lesson editor
 * (`author-<lessonId>`) and the knowledge base editors (`kb`). It opens that
 * scope's Trace as a dialog, whose switch turns recording on for that scope
 * only. While it records, the button says so.
 */
import { useRef, useState } from 'react';
import Footprints from 'lucide-react/dist/esm/icons/footprints';
import useTraceSwitch from '../../hooks/useTraceSwitch.js';
import LessonTrace from './LessonTrace.jsx';
import { Button } from '@/components/ui/button';
import TraceRecordingDot from './TraceRecordingDot.jsx';

export default function TraceButton({ scope, label, switchLabel, size = 'sm', className }) {
  const control = useTraceSwitch(scope);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  return (
    <>
      <Button ref={buttonRef} variant="outline" size={size} className={className}
        aria-label={`${label}${control.on ? ' (recording)' : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Footprints aria-hidden="true" className="size-4" />
        Trace
        {control.on && <TraceRecordingDot withText />}
      </Button>
      <LessonTrace scope={scope} open={open} docked={false} recording={control.on} control={control} switchLabel={switchLabel}
        onClose={() => { setOpen(false); requestAnimationFrame(() => buttonRef.current?.focus()); }} />
    </>
  );
}
