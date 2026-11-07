import { useState } from 'react';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import { adminApi } from './adminApi.js';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Admin → Users → User Groups (#434): add, rename (members, wait-list
 * entries, invites, and sent messages come along), and delete with a
 * confirmation. The server keeps the list sorted A–Z with None/Other last
 * (lib/groups.js). Errors show here, in the dialog, not behind it.
 */
export default function GroupsDialog({ open, onOpenChange, groups, memberCounts, onChanged }) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null); // group being renamed
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  // A rename that couldn't move everyone: { from, to }. Saving the same
  // rename again finishes it (the server sees `to` listed and `from` gone).
  const [unfinished, setUnfinished] = useState(null);

  async function call(fn, done) {
    setBusy(true);
    setError('');
    try {
      const data = await fn();
      onChanged(data.userGroups || []);
      setStatus(done(data));
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await call(() => adminApi('PUT', '/v1/admin/groups', { name }), () => `Added ${name}.`)) setNewName('');
  };

  const rename = async (oldName) => {
    const name = draft.trim();
    if (!name || name === oldName) { setEditing(null); return; }
    const ok = await call(() => adminApi('PUT', '/v1/admin/groups', { oldName, name }), (d) => {
      const m = d.moved || {};
      const moved = (m.users || 0) + (m.invites || 0);
      setUnfinished(m.failed ? { from: oldName, to: name } : null);
      return `Renamed ${oldName} to ${name}${moved ? `; ${people(moved)} moved with it` : ''}.${m.failed ? ` ${m.failed} couldn’t be updated yet.` : ''}`;
    });
    if (ok) setEditing(null);
  };

  const finishMove = ({ from, to }) => call(() => adminApi('PUT', '/v1/admin/groups', { oldName: from, name: to }), (d) => {
    const m = d.moved || {};
    setUnfinished(m.failed ? { from, to } : null);
    return m.failed ? `${m.failed} still couldn’t be moved to ${to}. Try again in a moment.` : `Everyone from ${from} is now in ${to}.`;
  });

  const remove = (name) => call(() => adminApi('DELETE', `/v1/admin/groups/${encodeURIComponent(name)}`), () => `Deleted ${name}.`);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setEditing(null); setError(''); setStatus(''); } onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>User Groups</DialogTitle>
          <DialogDescription>People choose a group when they sign up. Renaming keeps everyone in it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Label htmlFor="new-group-name" className="sr-only">New group name</Label>
            <Input id="new-group-name" type="text" placeholder="New group name" value={newName} maxLength={80}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }} className="flex-1" />
            <Button onClick={add} disabled={busy || !newName.trim()}>Add</Button>
          </div>
          {groups.length > 0 ? (
            <ul className="space-y-1" aria-label="Groups">
              {groups.map((g) => (
                <li key={g} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                  {editing === g ? (
                    <>
                      <Label htmlFor="rename-group" className="sr-only">New name for {g}</Label>
                      <Input id="rename-group" autoFocus value={draft} maxLength={80} className="h-8 flex-1"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') rename(g); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />
                      <Button size="sm" onClick={() => rename(g)} disabled={busy}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{g}</span>
                      <span className="text-xs text-muted-foreground">{people(memberCounts[g] || 0)}</span>
                      <Button variant="ghost" size="icon-xs" aria-label={`Rename group ${g}`} title="Rename" onClick={() => { setEditing(g); setDraft(g); setError(''); }}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete group ${g}`} onClick={() => setDeleting(g)}>&#10005;</Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No user groups yet.</p>
          )}
          {unfinished && (
            <Button variant="outline" size="sm" onClick={() => finishMove(unfinished)} disabled={busy}>
              Finish moving people from {unfinished.from} to {unfinished.to}
            </Button>
          )}
          <p className="sr-only" role="status" aria-live="polite">{status}</p>
          {status && <p className="text-sm text-muted-foreground" aria-hidden="true">{status}</p>}
        </div>
        <ConfirmModal
          open={!!deleting}
          onOpenChange={(o) => { if (!o) setDeleting(null); }}
          title={`Delete ${deleting || 'this group'}?`}
          message={`${people(memberCounts[deleting] || 0)} will no longer be in a group. Messages already sent to it stay as they are.`}
          confirmLabel="Delete group"
          onConfirm={() => { const g = deleting; setDeleting(null); remove(g); }}
        />
      </DialogContent>
    </Dialog>
  );
}
