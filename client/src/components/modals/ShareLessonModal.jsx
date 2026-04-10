import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { adminApi } from '../../pages/admin/adminApi.js';

export default function ShareLessonModal({
  open,
  onOpenChange,
  lessonName,
  initialSharedWith = [],
  initialStatus = 'private',
  onConfirm,
}) {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set(initialSharedWith));
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialSharedWith));
    setStatus(initialStatus);
    setSearch('');
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await adminApi('GET', '/v1/admin/users');
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, initialSharedWith, initialStatus]);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  function toggle(userId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleConfirm() {
    onConfirm({ status, sharedWith: status === 'public' ? [] : [...selected] });
  }

  const isPublic = status === 'public';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Visibility &amp; Sharing</DialogTitle>
          <DialogDescription>
            Control who can see <strong>{lessonName}</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* Public / Private toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden" role="radiogroup" aria-label="Lesson visibility">
          <button
            type="button"
            role="radio"
            aria-checked={isPublic}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${isPublic ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
            onClick={() => setStatus('public')}
          >
            Public
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isPublic}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${!isPublic ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
            onClick={() => setStatus('private')}
          >
            Private
          </button>
        </div>

        {isPublic ? (
          <p className="text-sm text-muted-foreground py-4">
            This lesson will be visible to all learners in the classroom.
          </p>
        ) : (
          <>
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users"
            />

            <ScrollArea className="h-64 rounded-md border">
              {loading ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground" role="status">Loading users...</div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No users found.</div>
              ) : (
                <div className="p-2 space-y-1" role="group" aria-label="User list">
                  {filtered.map(u => (
                    <label
                      key={u.userId}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(u.userId)}
                        onChange={() => toggle(u.userId)}
                        className="rounded border-input"
                        aria-label={`Share with ${u.name || u.email}`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="font-medium truncate block">{u.name || u.username || u.email}</span>
                        {u.name && <span className="text-xs text-muted-foreground truncate block">{u.email}</span>}
                      </span>
                      {u.role === 'admin' && <span className="text-xs text-muted-foreground">Admin</span>}
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="text-xs text-muted-foreground">
              {selected.size} {selected.size === 1 ? 'user' : 'users'} selected
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!isPublic && selected.size === 0}>
            {isPublic ? 'Make Public' : `Share with ${selected.size} ${selected.size === 1 ? 'user' : 'users'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
