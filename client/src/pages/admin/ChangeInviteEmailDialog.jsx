import { useState } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

/**
 * Admin → Users → an invite row → Change email: fix a mistyped address.
 * PUT /v1/admin/invites/:token/email sends a fresh invite to the new address
 * with the same details, and the old link stops working.
 * `invite`: { inviteToken, email } or null (closed).
 */
export default function ChangeInviteEmailDialog({ invite, onOpenChange, onDone }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function close(open) {
    if (!open) { setEmail(''); setError(''); setSaving(false); }
    onOpenChange(open);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const r = await adminApi('PUT', `/v1/admin/invites/${encodeURIComponent(invite.inviteToken)}/email`, { email });
      onDone(r, invite.email);
      close(false);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!invite} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change invite email</DialogTitle>
          <DialogDescription>
            {invite ? <>Sends a new invite to the right address, with the same details. The link sent to <strong>{invite.email}</strong> stops working.</> : null}
          </DialogDescription>
        </DialogHeader>
        <form id="change-invite-email" onSubmit={submit} className="space-y-3">
          {error && <p className="text-sm text-red-800 dark:text-destructive" role="alert">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="change-invite-email-input">New email</Label>
            <Input id="change-invite-email-input" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button type="submit" form="change-invite-email" disabled={saving || !email.trim()}>{saving ? 'Sending…' : 'Change and send'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
