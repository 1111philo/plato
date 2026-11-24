/**
 * "ⓘ": an explanation a first-time reader can open and a repeat reader can
 * skip (#595). A button (aria-expanded) that shows its note inline. Closed by
 * default, every time.
 */
import { useId, useState } from 'react';
import Info from 'lucide-react/dist/esm/icons/info';

/** `text`: show the label as a small link instead of the ⓘ icon (for a question worth reading, like "Who is the Coach?"). */
export default function Explain({ label, children, className = '', text = false }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      {text ? (
        <button type="button" aria-expanded={open} aria-controls={id}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className={`inline-flex shrink-0 items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring ${className}`}>
          <Info aria-hidden="true" className="size-3.5" />{label}
        </button>
      ) : (
        <button type="button" aria-expanded={open} aria-controls={id} aria-label={label} title={label}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring ${className}`}>
          <Info aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {open && (
        <div id={id} className="mt-1 basis-full rounded-sm border-l-2 border-sky-700 bg-background px-2 py-1 text-xs text-muted-foreground dark:border-sky-400">
          {children}
        </div>
      )}
    </>
  );
}
