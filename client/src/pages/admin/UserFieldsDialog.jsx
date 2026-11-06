import { useState } from 'react';
import { adminApi } from './adminApi.js';
import { FIELD_TYPE_OPTIONS, fieldTypeLabel } from '../../lib/userFields.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm';
const EMPTY_FORM = { label: '', type: 'text', required: false, options: '', hideFromLearner: false, hideFromApi: false };

/**
 * Admin → Users → "User Fields": manage admin-defined custom user fields
 * (#364). Same add/list/delete shape as the User Groups dialog, plus edit and
 * reorder. Changing a type is allowed; if stored answers wouldn't pass the
 * new rules, the server replies 409 with a count and we confirm first.
 */
export default function UserFieldsDialog({ open, onOpenChange, fields, onChange }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
  }

  function startEdit(f) {
    setEditingId(f.id);
    setForm({ label: f.label, type: f.type, required: !!f.required, options: (f.options || []).join('\n'), hideFromLearner: !!f.hideFromLearner, hideFromApi: !!f.hideFromApi });
    setError('');
  }

  async function run(fn) {
    setSaving(true);
    setError('');
    try {
      const data = await fn();
      onChange(data.userFields || []);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const body = {
      label: form.label,
      type: form.type,
      // A field only admins see can't be required of learners (the server agrees).
      required: form.required && !form.hideFromLearner,
      hideFromLearner: form.hideFromLearner,
      hideFromApi: form.hideFromApi,
      options: form.type === 'dropdown' ? form.options.split('\n') : undefined,
    };
    const ok = await run(async () => {
      if (!editingId) return adminApi('POST', '/v1/admin/user-fields', body);
      const path = `/v1/admin/user-fields/${editingId}`;
      try {
        return await adminApi('PUT', path, body);
      } catch (err) {
        // A new type (or fewer dropdown options) can leave stored answers that
        // no longer pass; the server reports how many and waits for a yes.
        if (err.status !== 409 || !err.data?.invalidCount) throw err;
        const n = err.data.invalidCount;
        if (!confirm(`${n} existing ${n === 1 ? 'answer doesn\'t' : 'answers don\'t'} fit the new rules. They'll be kept, but must be fixed the next time they're edited. Save anyway?`)) {
          throw new Error('Not saved.');
        }
        return adminApi('PUT', path, { ...body, confirmInvalid: true });
      }
    });
    if (ok) resetForm();
  }

  async function handleDelete(f) {
    if (!confirm(`Delete the "${f.label}" field? Every user's answer to it will be erased. This cannot be undone.`)) return;
    const ok = await run(() => adminApi('DELETE', `/v1/admin/user-fields/${f.id}`));
    if (ok && editingId === f.id) resetForm();
  }

  function handleMove(idx, delta) {
    const ids = fields.map((f) => f.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(idx + delta, 0, moved);
    run(() => adminApi('PUT', '/v1/admin/user-fields/order', { ids }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>User Fields</DialogTitle>
          <DialogDescription>
            Extra profile fields users fill in at signup and in their settings. Required fields must be completed before a user can continue to their lessons. A field can be hidden from learners (admins only) or from public forms.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {fields.length > 0 ? (
            <ul className="space-y-1" aria-label="Custom user fields">
              {fields.map((f, idx) => (
                <li key={f.id} className="flex items-center gap-2 rounded-md px-3 py-2 bg-muted/50">
                  <span className="text-sm flex-1 min-w-0 truncate">{f.label}</span>
                  <Badge variant="outline">{fieldTypeLabel(f.type)}</Badge>
                  {f.required && <Badge variant="secondary">Required</Badge>}
                  {f.hideFromLearner && <Badge variant="outline">Admins only</Badge>}
                  {f.hideFromApi && !f.hideFromLearner && <Badge variant="outline">Not on public forms</Badge>}
                  <Button variant="ghost" size="icon-xs" title="Move up" aria-label={`Move ${f.label} up`} disabled={saving || idx === 0} onClick={() => handleMove(idx, -1)}>&uarr;</Button>
                  <Button variant="ghost" size="icon-xs" title="Move down" aria-label={`Move ${f.label} down`} disabled={saving || idx === fields.length - 1} onClick={() => handleMove(idx, 1)}>&darr;</Button>
                  <Button variant="ghost" size="icon-xs" title="Edit" aria-label={`Edit field ${f.label}`} aria-pressed={editingId === f.id} disabled={saving} onClick={() => startEdit(f)}>&#9998;</Button>
                  <Button variant="ghost" size="icon-xs" title="Delete" aria-label={`Delete field ${f.label}`} disabled={saving} onClick={() => handleDelete(f)}>&#10005;</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No custom fields yet.</p>
          )}

          <form className="space-y-3 rounded-lg border p-3" onSubmit={handleSubmit} aria-labelledby="user-field-form-heading">
            <h3 id="user-field-form-heading" className="text-sm font-semibold">{editingId ? 'Edit field' : 'Add a field'}</h3>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="user-field-label">Label</Label>
              <Input id="user-field-label" value={form.label} maxLength={80}
                onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-field-type">Type</Label>
              <select id="user-field-type" className={SELECT_CLASS} value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {FIELD_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {form.type === 'dropdown' && (
              <div className="space-y-1.5">
                <Label htmlFor="user-field-options">Options <span className="text-muted-foreground text-xs">(one per line)</span></Label>
                <Textarea id="user-field-options" rows={4} value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <input id="user-field-required" type="checkbox" className="h-4 w-4" checked={form.required && !form.hideFromLearner}
                disabled={form.hideFromLearner} aria-describedby={form.hideFromLearner ? 'user-field-required-hint' : undefined}
                onChange={(e) => setForm({ ...form, required: e.target.checked })} />
              <Label htmlFor="user-field-required">Required</Label>
              {form.hideFromLearner && <span id="user-field-required-hint" className="text-xs text-muted-foreground">Learners can&rsquo;t see it, so it can&rsquo;t be required of them.</span>}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who sees it</legend>
              <div className="flex items-start gap-2">
                <input id="user-field-hide-learner" type="checkbox" className="mt-0.5 h-4 w-4" checked={form.hideFromLearner}
                  aria-describedby="user-field-hide-learner-hint"
                  onChange={(e) => setForm({ ...form, hideFromLearner: e.target.checked })} />
                <div>
                  <Label htmlFor="user-field-hide-learner">Hide from learners</Label>
                  <p id="user-field-hide-learner-hint" className="text-xs text-muted-foreground">Only admins see and set it. Not in the learner&rsquo;s profile, signup, or wait-list form.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <input id="user-field-hide-api" type="checkbox" className="mt-0.5 h-4 w-4" checked={form.hideFromApi || form.hideFromLearner}
                  disabled={form.hideFromLearner} aria-describedby="user-field-hide-api-hint"
                  onChange={(e) => setForm({ ...form, hideFromApi: e.target.checked })} />
                <div>
                  <Label htmlFor="user-field-hide-api">Hide from public forms and the wait-list API</Label>
                  <p id="user-field-hide-api-hint" className="text-xs text-muted-foreground">Not on signup or the wait-list form, and outside forms can&rsquo;t send it. Learners still see it in their profile.</p>
                </div>
              </div>
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || !form.label.trim()}>{editingId ? 'Save field' : 'Add field'}</Button>
              {editingId && <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>}
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
