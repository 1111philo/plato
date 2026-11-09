import { useState } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm';
const people = (n) => `${n} ${n === 1 ? 'user' : 'users'}`;

/**
 * Admin → Users → select users → "Update…": one change for everyone selected
 * (signed-up users and wait-list entries; someone who is both gets it on both),
 * either their group or one user field (any field, including admin-only ones).
 * Set it to a value or clear it; the sentence under the controls says exactly
 * what will happen before Apply. Server: POST /v1/admin/users/bulk-update,
 * which validates the change once and applies it per user.
 *
 * With the Slack plugin connected, "Slack link" links each account to the
 * workspace member with the same email (POST /v1/plugins/slack/admin/link);
 * existing links stay and nobody is added to a channel.
 */
const SLACK = '__slack';

export default function BulkUpdateDialog({ open, onOpenChange, userIds, waitlistTokens = [], groups, userFields, slackConnected = false, onDone }) {
  const [field, setField] = useState('userGroup');
  const [mode, setMode] = useState('set'); // 'set' | 'clear'
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const count = userIds.length + waitlistTokens.length;
  // Slack links accounts only; wait-list entries have none yet.
  const canSlack = slackConnected && userIds.length > 0;
  const isSlack = field === SLACK;
  const def = field === 'userGroup' || isSlack ? null : userFields.find((f) => f.id === field);
  const label = isSlack ? 'Slack link' : def ? def.label : 'Group';
  const options = field === 'userGroup' ? groups : def?.type === 'dropdown' ? def.options : null;
  const trimmed = value.trim();
  const ready = isSlack || mode === 'clear' || !!trimmed;

  function reset() {
    setField('userGroup'); setMode('set'); setValue(''); setError(''); setSaving(false);
  }

  function choose(next) {
    setField(next); setValue(''); setError('');
  }

  const sentence = isSlack
    ? `Links ${people(userIds.length)} to the Slack member with the same email. Existing links stay, and nobody is added to a channel.${waitlistTokens.length ? ` Wait-list entries are skipped.` : ''}`
    : mode === 'clear'
    ? `Clears ${label} for ${people(count)}.${def?.required ? ' It’s required, so learners will be asked for it again.' : ''}`
    : trimmed ? `Sets ${label} to “${trimmed}” for ${people(count)}.` : `Choose the new ${label.toLowerCase()}.`;

  async function apply(e) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      if (isSlack) {
        const result = await adminApi('POST', '/v1/plugins/slack/admin/link', { userIds });
        onDone(result, { label, slack: true });
        reset();
        onOpenChange(false);
        return;
      }
      const result = await adminApi('POST', '/v1/admin/users/bulk-update', {
        userIds, waitlistTokens, set: { field, value: mode === 'clear' ? null : trimmed },
      });
      onDone(result, { label, cleared: mode === 'clear', value: trimmed });
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
          <DialogTitle>Update {people(count)}</DialogTitle>
          <DialogDescription>Change one thing for everyone selected.</DialogDescription>
        </DialogHeader>
        <form id="bulk-update-form" onSubmit={apply} className="space-y-4">
          {error && <p className="text-sm text-red-800 dark:text-destructive" role="alert">{error}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="bulk-field">What to change</Label>
            <select id="bulk-field" className={SELECT_CLASS} value={field} onChange={(e) => choose(e.target.value)}>
              <option value="userGroup">Group</option>
              {userFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              {canSlack && <option value={SLACK}>Slack link</option>}
            </select>
          </div>

          {!isSlack && <fieldset className="space-y-2">
            <legend className="sr-only">New {label.toLowerCase()}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="bulk-mode" className="h-4 w-4 shrink-0 accent-primary" checked={mode === 'set'} onChange={() => setMode('set')} />
              Set to
            </label>
            {mode === 'set' && (
              <div className="pl-6">
                {options ? (
                  <select aria-label={`New ${label.toLowerCase()}`} className={SELECT_CLASS} value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">Choose…</option>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : def?.type === 'textarea' ? (
                  <Textarea aria-label={`New ${label.toLowerCase()}`} rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
                ) : (
                  <Input aria-label={`New ${label.toLowerCase()}`} type={def?.type === 'link' ? 'url' : def?.type === 'phone' ? 'tel' : 'text'}
                    value={value} onChange={(e) => setValue(e.target.value)} />
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="bulk-mode" className="h-4 w-4 shrink-0 accent-primary" checked={mode === 'clear'} onChange={() => setMode('clear')} />
              {field === 'userGroup' ? 'Remove from their group' : 'Clear it'}
            </label>
          </fieldset>}

          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm" aria-live="polite">{sentence}</p>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="bulk-update-form" disabled={saving || !ready}>{saving ? (isSlack ? 'Linking…' : 'Updating…') : isSlack ? `Link ${people(userIds.length)}` : `Update ${people(count)}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
