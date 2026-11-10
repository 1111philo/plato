import { useEffect, useMemo, useState } from 'react';
import { adminApi } from './adminApi.js';
import { normalizeRole, roleLabel } from '../../lib/permissions.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

const lessonsLabel = (n) => `${n} ${n === 1 ? 'lesson' : 'lessons'}`;
const peopleLabel = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Admin → Lessons → select lessons → "Update…" (#526): make them public, or
 * private and (optionally) shared with chosen people, either added to who
 * each is already shared with or replacing it. The sentence under the
 * controls says exactly what will happen. Server:
 * POST /v1/admin/lessons/bulk-update (same rules as the single-lesson save).
 */
export default function BulkLessonsDialog({ open, onOpenChange, lessonIds, onDone }) {
  const [status, setStatus] = useState('private');
  const [mode, setMode] = useState('add'); // 'add' | 'replace'
  const [people, setPeople] = useState(new Set());
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const count = lessonIds.length;

  useEffect(() => {
    if (!open || users) return;
    adminApi('GET', '/v1/admin/users').then((d) => setUsers(Array.isArray(d) ? d : [])).catch(() => setUsers([]));
  }, [open, users]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users || [];
    return q ? list.filter((u) => [u.name, u.email, u.username].some((v) => (v || '').toLowerCase().includes(q))) : list;
  }, [users, search]);

  function reset() {
    setStatus('private'); setMode('add'); setPeople(new Set()); setSearch(''); setError(''); setSaving(false);
  }
  function toggle(id) {
    setPeople((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  const sentence = status === 'public'
    ? `Makes ${lessonsLabel(count)} public: every learner can see them.`
    : people.size === 0
      ? (mode === 'replace' ? `Makes ${lessonsLabel(count)} private, shared with no one.` : `Makes ${lessonsLabel(count)} private. Who they’re shared with stays the same.`)
      : mode === 'replace'
        ? `Makes ${lessonsLabel(count)} private, shared with only ${peopleLabel(people.size)}.`
        : `Makes ${lessonsLabel(count)} private and shares them with ${peopleLabel(people.size)}, added to who they’re already shared with.`;

  async function apply(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const share = status === 'private' && (people.size || mode === 'replace') ? { mode, userIds: [...people] } : undefined;
      const result = await adminApi('POST', '/v1/admin/lessons/bulk-update', { lessonIds, status, share });
      onDone(result, { status, shared: share ? people.size : 0 });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update {lessonsLabel(count)}</DialogTitle>
          <DialogDescription>Change who can see the selected lessons.</DialogDescription>
        </DialogHeader>
        <form id="bulk-lessons-form" onSubmit={apply} className="space-y-4">
          {error && <p className="text-sm text-red-800 dark:text-destructive" role="alert">{error}</p>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Visibility</legend>
            {[['public', 'Public'], ['private', 'Private']].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="bulk-lesson-status" className="h-4 w-4 shrink-0 accent-primary"
                  checked={status === value} onChange={() => setStatus(value)} />
                {label}
              </label>
            ))}
          </fieldset>

          {status === 'private' && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Share with</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="bulk-lesson-share" className="h-4 w-4 shrink-0 accent-primary" checked={mode === 'add'} onChange={() => setMode('add')} />
                  Add to who each is shared with
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="bulk-lesson-share" className="h-4 w-4 shrink-0 accent-primary" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  Only the people chosen here
                </label>
              </fieldset>
              <div className="space-y-2">
                <Input aria-label="Search people" placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="max-h-56 overflow-y-auto rounded-md border p-2" role="group" aria-label="People">
                  {users === null ? (
                    <p className="text-sm text-muted-foreground" role="status">Loading…</p>
                  ) : shown.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No one matches.</p>
                  ) : shown.map((u) => (
                    <label key={u.userId} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={people.has(u.userId)} onChange={() => toggle(u.userId)}
                        aria-label={`Share with ${u.name || u.email}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{u.name || u.username || u.email}</span>
                        {u.name && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
                      </span>
                      {normalizeRole(u.role) !== 'learner' && <span className="text-xs text-muted-foreground">{roleLabel(u.role)}</span>}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm" aria-live="polite">{sentence}</p>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="bulk-lessons-form" disabled={saving}>{saving ? 'Updating…' : `Update ${lessonsLabel(count)}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
