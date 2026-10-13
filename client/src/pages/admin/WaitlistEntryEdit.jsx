import { useState } from 'react';
import { adminApi } from './adminApi.js';
import CustomFieldInput from '../../components/CustomFieldInput.jsx';
import { missingRequired } from '../../lib/userFields.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Admin → Users → a wait-list row (#363): edit the person's name, email,
 * group, and custom field answers before inviting them. Deep-linked at
 * /plato/users/waitlist/:token, same shape as the Edit User view.
 */
export default function WaitlistEntryEdit({ entry, groups, userFields, onBack, onSaved, onInvite, onRemove }) {
  const [form, setForm] = useState({
    name: entry.name || '',
    email: entry.email || '',
    userGroup: entry.userGroup || '',
    customFields: { ...(entry.customFields || {}) },
  });
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const missing = missingRequired(userFields, form.customFields);
    if (missing.length) {
      const labels = userFields.filter(f => missing.includes(f.id)).map(f => f.label);
      setMessage({ text: `Fill in required ${labels.length === 1 ? 'field' : 'fields'}: ${labels.join(', ')}.`, type: 'error' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await adminApi('PUT', `/v1/admin/waitlist/${entry.inviteToken}`, {
        name: form.name,
        email: form.email,
        userGroup: form.userGroup || null,
        // Send every defined field so cleared inputs clear the stored answer.
        customFields: Object.fromEntries(userFields.map((f) => [f.id, form.customFields[f.id] ?? ''])),
      });
      onSaved(`Saved ${form.email.trim().toLowerCase()}.`);
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to users">&larr; Back</Button>
        <h1 className="text-2xl font-bold">Edit Wait List Entry</h1>
      </div>
      {message && (
        <div className={`rounded-lg px-4 py-3 mb-4 text-sm ${message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800'}`} role="alert">
          {message.text}
        </div>
      )}
      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Joined {new Date(entry.createdAt).toLocaleDateString()}. Invite sends the signup email, prefilled with these answers.
          </p>
          <div className="space-y-2">
            <Label htmlFor="wl-edit-name">Name</Label>
            <Input id="wl-edit-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wl-edit-email">Email</Label>
            <Input id="wl-edit-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wl-edit-group">User Group</Label>
            <select id="wl-edit-group" value={form.userGroup}
              onChange={e => setForm({ ...form, userGroup: e.target.value })}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
              <option value="">None</option>
              {/* Keep a group that's since been renamed/deleted visible rather than silently blanking it. */}
              {form.userGroup && !groups.includes(form.userGroup) && <option value={form.userGroup}>{form.userGroup} (no longer a group)</option>}
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {userFields.map(f => (
            <CustomFieldInput
              key={f.id}
              field={f}
              idPrefix="wl-edit-field"
              value={form.customFields[f.id]}
              onChange={(v) => setForm(prev => ({ ...prev, customFields: { ...prev.customFields, [f.id]: v } }))}
              disabled={saving}
            />
          ))}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
            <Button variant="outline" onClick={onBack}>Cancel</Button>
            <Button variant="outline" className="ml-auto" onClick={() => onInvite(entry)} disabled={saving}>Invite</Button>
            <Button variant="destructive" onClick={() => onRemove(entry)} disabled={saving}>Remove</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
