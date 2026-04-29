/**
 * Template: minimal settings panel for a plato plugin.
 *
 * Copy into plugins/<id>/client/SettingsPanel.jsx. Wire it from
 * plugins/<id>/client/index.js as the adminSettingsPanel slot:
 *
 *   import SettingsPanel from './SettingsPanel.jsx';
 *   export default { slots: { adminSettingsPanel: SettingsPanel } };
 *
 * Manifest must include:
 *   "capabilities": ["ui.slot.adminSettingsPanel", "settings.read", "settings.write"],
 *   "extensionPoints": { "slots": { "adminSettingsPanel": "client/SettingsPanel.jsx" } }
 *
 * Props (from the slot contract):
 *   - pluginId: 'your-plugin-id'
 *   - settings: { ...current settings... }
 *   - onSave: (next) => Promise<void>  // persists via PUT /v1/admin/plugins/<id>/settings
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SettingsPanel({ settings, onSave }) {
  const [draft, setDraft] = useState({ ...(settings || {}) });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await onSave(draft);
      setMessage({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="example-string">Example text setting</Label>
        <Input
          id="example-string"
          value={draft.example || ''}
          onChange={(e) => setDraft({ ...draft, example: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!draft.enabled_feature}
          onChange={(e) => setDraft({ ...draft, enabled_feature: e.target.checked })}
        />
        <Label>Example boolean setting</Label>
      </label>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {message && (
          <span
            role="status"
            aria-live="polite"
            className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
