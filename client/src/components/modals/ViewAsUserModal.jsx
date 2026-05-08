import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { adminApi } from '../../pages/admin/adminApi.js';
import { useAuth } from '../../contexts/AuthContext.jsx';

/**
 * Admin "View as User" picker — single-select learner search.
 *
 * Modeled on ShareLessonModal's user list pattern but with click-to-pick
 * rather than multi-select checkboxes. Admins are filtered out (no point
 * impersonating other admins, less foot-gun risk). On select we kick off
 * the impersonation start API call, persist target to sessionStorage,
 * close the modal, and let the caller redirect to the classroom.
 */
export default function ViewAsUserModal({ open, onOpenChange, onStarted }) {
  const { startImpersonation, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setError(null);
    setSubmitting(false);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await adminApi('GET', '/v1/admin/users');
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load users');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => {
    // Hide admins (don't impersonate self / other admins) and apply search.
    const learners = users.filter(u => u.role !== 'admin' && u.userId !== currentUser?.userId);
    if (!search.trim()) return learners;
    const q = search.toLowerCase();
    return learners.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q)
    );
  }, [users, search, currentUser]);

  async function handlePick(target) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await startImpersonation(target.userId);
      onOpenChange(false);
      if (onStarted) onStarted(target);
    } catch (e) {
      setError(e?.message || 'Failed to start');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>View as User</DialogTitle>
          <DialogDescription>
            See the classroom as a specific learner — read-only.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />

        <ScrollArea className="h-64 rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground" role="status">Loading users...</div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-sm text-destructive p-4 text-center" role="alert">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No learners found.</div>
          ) : (
            <ul className="p-2 space-y-1" aria-label="Learners">
              {filtered.map(u => {
                const label = u.name || u.username || u.email;
                return (
                  <li key={u.userId}>
                    <button
                      type="button"
                      onClick={() => handlePick(u)}
                      disabled={submitting}
                      aria-label={`View as ${label}`}
                      className="w-full flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted text-left text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none outline-none focus:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="font-medium truncate block">{label}</span>
                        {u.name && <span className="text-xs text-muted-foreground truncate block">{u.email}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
