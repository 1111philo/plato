/**
 * Shown on a Trace button while Trace is recording that conversation (#595),
 * so a person can see it's on without opening it. Decorative: the button's
 * accessible name says "(recording)".
 */
export default function TraceRecordingDot({ withText = false }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      <span className="size-2.5 rounded-full bg-red-600 ring-2 ring-background dark:bg-red-400" />
      {withText && <span className="text-xs font-medium text-red-800 dark:text-red-300">Recording</span>}
    </span>
  );
}
