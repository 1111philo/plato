import { useCallback, useEffect, useRef, useState } from 'react';
import * as DropdownMenuRadix from '@radix-ui/react-dropdown-menu';
import Bell from 'lucide-react/dist/esm/icons/bell';
import { authenticatedFetch } from '../../js/auth.js';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * The classroom's notifications (#389): a bell in the header listing messages
 * from the classroom's admins, and a one-time pop-up for messages marked
 * important. Opening the menu marks what it shows as read. Server:
 * GET /v1/me/messages, POST /v1/me/messages/read (lib/messages.js).
 * Re-checks when the tab comes back into view; there's no polling.
 */
export default function NotificationsBell() {
  const [messages, setMessages] = useState([]);
  const [reading, setReading] = useState(null); // the message open in the dialog
  const [popup, setPopup] = useState(null);
  const popupShown = useRef(new Set());

  const fetchMessages = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/v1/me/messages');
      if (!res.ok) return null;
      return (await res.json()).messages || [];
    } catch { return null; }
  }, []);

  const apply = useCallback((list) => {
    if (!list) return;
    setMessages(list);
    // One pop-up at a time: the newest unread important message not yet shown.
    const next = list.find((m) => m.important && !m.read && !popupShown.current.has(m.id));
    if (next) { popupShown.current.add(next.id); setPopup(next); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetchMessages().then((list) => { if (!cancelled) apply(list); }); };
    refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchMessages, apply]);

  const markRead = useCallback(async (ids) => {
    if (!ids.length) return;
    setMessages((list) => list.map((m) => (ids.includes(m.id) ? { ...m, read: true } : m)));
    try {
      await authenticatedFetch('/v1/me/messages/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      });
    } catch { /* best-effort; it shows as unread again next load */ }
  }, []);

  const unread = messages.filter((m) => !m.read).length;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  const when = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <>
      {/* Non-modal: a modal Radix menu aria-hides the whole page while open
          (axe aria-hidden-focus). Menus aren't modal in WAI-ARIA anyway. */}
      <DropdownMenuRadix.Root modal={false} onOpenChange={(open) => { if (open) markRead(messages.filter((m) => !m.read).map((m) => m.id)); }}>
        <DropdownMenuRadix.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            title="Notifications"
            className="relative text-inherit opacity-80 hover:opacity-100 hover:bg-white/10 cursor-pointer bg-transparent border-none rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unread > 0 && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        </DropdownMenuRadix.Trigger>
        <DropdownMenuRadix.Portal>
          <DropdownMenuRadix.Content align="end" sideOffset={4} className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
            <DropdownMenuRadix.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Notifications</DropdownMenuRadix.Label>
            <DropdownMenuRadix.Separator className="my-1 h-px bg-border" />
            {messages.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {messages.map((m) => (
                  <DropdownMenuRadix.Item
                    key={m.id}
                    onSelect={() => setReading(m)}
                    className="flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus:bg-accent"
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className={`flex-1 truncate ${m.read ? '' : 'font-semibold'}`}>{m.subject}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{when(m.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{m.body}</span>
                    {!m.read && <span className="sr-only">Unread.</span>}
                  </DropdownMenuRadix.Item>
                ))}
              </div>
            )}
          </DropdownMenuRadix.Content>
        </DropdownMenuRadix.Portal>
      </DropdownMenuRadix.Root>

      <MessageDialog message={reading} onClose={() => setReading(null)} />
      <MessageDialog
        message={popup}
        confirmLabel="Got it"
        onClose={() => { if (popup) markRead([popup.id]); setPopup(null); }}
      />
    </>
  );
}

function MessageDialog({ message, onClose, confirmLabel = 'Close' }) {
  return (
    <Dialog open={!!message} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        {message && (
          <>
            <DialogHeader>
              <DialogTitle>{message.subject}</DialogTitle>
              <DialogDescription>
                {message.fromName ? `From ${message.fromName}, ` : ''}{new Date(message.createdAt).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm leading-relaxed">
              {message.body.split(/\n\s*\n/).map((p, i) => (
                <p key={i} className="whitespace-pre-line">{p}</p>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{confirmLabel}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
