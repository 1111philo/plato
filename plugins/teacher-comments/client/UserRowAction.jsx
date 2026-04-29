/**
 * Teacher Comments — per-user row action.
 *
 * Slot: adminUserRowAction. Renders a small "Note" indicator next to the
 * user's row in /plato/users; clicking opens an inline editor.
 *
 * Props (slot contract): { user: AdminUser }
 *
 * Phase-1 NOTE: this slot is declared in the SDK + capability vocabulary and
 * the registry will load this component, but `AdminUsers.jsx` doesn't yet
 * call `<PluginSlot name="adminUserRowAction" context={{ user }} />`. So this
 * component renders to nothing today. Once the host adds the render-point,
 * this component lights up automatically — no changes here required.
 */

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { authenticatedFetch } from '../../../client/js/auth.js';

async function api(method, path, body) {
  const res = await authenticatedFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function UserRowAction({ user }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api('GET', `/v1/plugins/teacher-comments/admin/comments/${user.userId}`)
      .then((c) => { if (!cancelled) { setText(c?.text || ''); setOriginal(c?.text || ''); } })
      .catch(() => { if (!cancelled) { setText(''); setOriginal(''); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, user.userId]);

  async function save() {
    setSaving(true);
    try {
      await api('PUT', `/v1/plugins/teacher-comments/admin/comments/${user.userId}`, { text: text.trim() });
      setOriginal(text.trim());
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const dirty = text.trim() !== original;

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Note for ${user.name || user.email}`}>
        📝 Note
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Note — {user.name || user.email}</DialogTitle>
          </DialogHeader>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="Private note visible only to admins…"
              autoFocus
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
