import { useState } from 'react';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * Choose which columns an admin table shows and their order (#385). Shared
 * by Admin → Users and Admin → Lessons. `columns` comes from
 * lib/tableColumns.js `arrangeable()`. Moves are buttons (no drag and drop),
 * focus stays on the moved row's button, and each change is announced.
 */
export default function ColumnsDialog({ open, onOpenChange, title, columns, onToggle, onMove, onReset }) {
  const [announcement, setAnnouncement] = useState('');
  const say = (text) => { setAnnouncement(''); requestAnimationFrame(() => setAnnouncement(text)); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Saved in this browser.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1" aria-label="Columns">
          {columns.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
              <label className="flex flex-1 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={!c.hidden}
                  onChange={(e) => { onToggle(c.id, e.target.checked); say(`${c.label} ${e.target.checked ? 'shown' : 'hidden'}.`); }} />
                {c.label}
              </label>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${c.label} up`} disabled={i === 0}
                onClick={() => { onMove(c.id, -1); say(`Moved ${c.label} up.`); }}>
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${c.label} down`} disabled={i === columns.length - 1}
                onClick={() => { onMove(c.id, 1); say(`Moved ${c.label} down.`); }}>
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onReset(); say('Columns reset.'); }}>Reset</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
