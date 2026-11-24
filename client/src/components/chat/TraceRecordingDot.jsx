/**
 * Shown while Trace is recording a conversation (#595): in the lesson header,
 * on the Trace tab, on the profile's Trace button. Decorative: whatever it sits
 * in says "recording" in words.
 */
/** `withText`: true, or 'wide' for the word only from the sm breakpoint up (the lesson header on a phone). */
export default function TraceRecordingDot({ withText = false }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      <span className="size-2.5 rounded-full bg-red-600 ring-2 ring-background dark:bg-red-400" />
      {withText && <span className={`text-xs font-medium text-red-800 dark:text-red-300 ${withText === 'wide' ? 'hidden sm:inline' : ''}`}>Recording</span>}
    </span>
  );
}
