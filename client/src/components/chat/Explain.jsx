/**
 * "ⓘ": an explanation a first-time reader can open and a repeat reader can
 * skip (#595). A small popover anchored to its button, styled like the app's
 * menus: click or Enter opens it, Escape or a click outside closes it, and
 * focus returns to the button. Closed by default, every time.
 */
import { Popover } from '@base-ui/react/popover';
import Info from 'lucide-react/dist/esm/icons/info';

const popup = 'z-50 max-w-xs rounded-lg bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

/** `text`: show the label as a small link instead of the ⓘ icon (for a question worth reading, like "Who is the Coach?"). */
export default function Explain({ label, children, className = '', text = false }) {
  return (
    <Popover.Root>
      {text ? (
        <Popover.Trigger className={`inline-flex shrink-0 items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring ${className}`}>
          <Info aria-hidden="true" className="size-3.5" />{label}
        </Popover.Trigger>
      ) : (
        <Popover.Trigger aria-label={label} title={label}
          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring ${className}`}>
          <Info aria-hidden="true" className="size-3.5" />
        </Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={8} className="isolate z-50">
          <Popover.Popup aria-label={label} className={popup}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
