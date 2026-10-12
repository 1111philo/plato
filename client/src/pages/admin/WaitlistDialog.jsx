import { useState } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

/**
 * Admin → Users → "Wait List" (#363): open or close the public form, and
 * make or revoke the API key an outside form uses. A new key is shown once.
 */
export default function WaitlistDialog({ open, onOpenChange, settings, onChange }) {
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function run(fn) {
    setSaving(true);
    setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  const toggleOpen = (next) => run(async () => {
    await adminApi('PUT', '/v1/admin/waitlist/settings', { open: next });
    onChange({ ...settings, open: next });
  });

  const makeKey = () => {
    if (settings.hasApiKey && !confirm('Make a new key? The old key will stop working.')) return;
    run(async () => {
      const { apiKey } = await adminApi('POST', '/v1/admin/waitlist/key');
      setNewKey(apiKey);
      setCopied(false);
      onChange({ ...settings, hasApiKey: true });
    });
  };

  const revokeKey = () => {
    if (!confirm('Revoke the key? Outside forms using it will stop working.')) return;
    run(async () => {
      await adminApi('DELETE', '/v1/admin/waitlist/key');
      setNewKey('');
      onChange({ ...settings, hasApiKey: false });
    });
  };

  async function copyKey() {
    try { await navigator.clipboard.writeText(newKey); setCopied(true); } catch { /* ignore */ }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setNewKey(''); setError(''); } onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Wait List</DialogTitle>
          <DialogDescription>
            People on the wait list show under the Wait List filter. Invite them from there.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex items-center gap-2">
          <input
            id="waitlist-open"
            type="checkbox"
            className="h-4 w-4"
            checked={!!settings.open}
            disabled={saving}
            onChange={(e) => toggleOpen(e.target.checked)}
          />
          <Label htmlFor="waitlist-open">Show &quot;Join the wait list&quot; on the sign-in page</Label>
        </div>
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">API key</h3>
          <p className="text-sm text-muted-foreground">
            An outside form can add people by sending <code>POST /v1/waitlist</code> with the header{' '}
            <code>Authorization: Bearer &lt;key&gt;</code>. This works even when the wait list is closed.
            Send it from a server, not from a web page, so the key stays private.
          </p>
          {newKey && (
            <div className="space-y-1">
              <Label htmlFor="waitlist-new-key">New key (shown once)</Label>
              <div className="flex gap-2">
                <Input id="waitlist-new-key" readOnly value={newKey} onFocus={(e) => e.target.select()} />
                <Button variant="outline" onClick={copyKey}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={makeKey} disabled={saving}>
              {settings.hasApiKey ? 'Make a new key' : 'Make a key'}
            </Button>
            {settings.hasApiKey && (
              <Button variant="destructive" onClick={revokeKey} disabled={saving}>Revoke key</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
