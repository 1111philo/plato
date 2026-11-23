/**
 * A "Trace" button for the places outside a lesson that Trace mode records
 * (#595): Settings → Learner Profile (scope `profile`), the lesson editor
 * (`author-<lessonId>`) and the knowledge base editors (`kb`). It opens that
 * scope's Trace as a dialog.
 *
 * Shown while Trace mode is on for the signed-in person. With `whenRecorded`
 * it is also shown when the scope already has a trace, so what was recorded
 * stays readable after the switch is turned off.
 */
import { useEffect, useRef, useState } from 'react';
import Footprints from 'lucide-react/dist/esm/icons/footprints';
import { useApp } from '../../contexts/AppContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { listTraceRecords } from '../../../js/storage.js';
import { isTraceOn } from '../../lib/lessonTrace.js';
import LessonTrace from './LessonTrace.jsx';
import { Button } from '@/components/ui/button';

export default function TraceButton({ scope, label, whenRecorded = false, size = 'sm', className }) {
  const { state } = useApp();
  const { user } = useAuth();
  const on = isTraceOn({ preferences: state.preferences, user });
  const [recorded, setRecorded] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!whenRecorded || on) return undefined;
    let cancelled = false;
    listTraceRecords(scope, 't').then((items) => { if (!cancelled) setRecorded(items.length > 0); });
    return () => { cancelled = true; };
  }, [whenRecorded, on, scope]);

  if (!on && !recorded) return null;
  return (
    <>
      <Button ref={buttonRef} variant="outline" size={size} className={className} aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Footprints aria-hidden="true" className="size-4" />
        Trace
      </Button>
      <LessonTrace scope={scope} open={open} docked={false} recording={on}
        onClose={() => { setOpen(false); requestAnimationFrame(() => buttonRef.current?.focus()); }} />
    </>
  );
}
