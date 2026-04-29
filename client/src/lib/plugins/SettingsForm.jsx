/**
 * Auto-renders a settings form from a JSON Schema fragment. Supports primitives
 * (string, number, boolean, enum) and a single level of object nesting. For
 * anything more complex, plugins should provide an `adminSettingsPanel` slot.
 *
 * Used by AdminPlugins.jsx as a fallback when a plugin declares a
 * settingsSchema but does not register a custom settingsPanel.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function fieldId(pluginId, key) {
  return `plugin-${pluginId}-${key}`;
}

function PrimitiveField({ pluginId, propKey, schema, value, onChange }) {
  const id = fieldId(pluginId, propKey);
  const label = propKey;
  const desc = schema.description;

  if (schema.type === 'boolean') {
    return (
      <div className="flex items-center gap-3 py-2">
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor={id} className="cursor-pointer">{label}</Label>
        {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
      </div>
    );
  }

  if (Array.isArray(schema.enum)) {
    return (
      <div className="space-y-1 py-2">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
    );
  }

  if (schema.type === 'number') {
    return (
      <div className="space-y-1 py-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          value={value ?? ''}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
    );
  }

  // Default: string. writeOnly fields use type=password to discourage shoulder-surfing.
  return (
    <div className="space-y-1 py-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={schema.writeOnly ? 'password' : 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
    </div>
  );
}

export default function SettingsForm({ pluginId, schema, settings, onSave }) {
  const [draft, setDraft] = useState(() => ({ ...(settings || {}) }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setDraft({ ...(settings || {}) });
  }, [settings, pluginId]);

  if (!schema || schema.type !== 'object' || !schema.properties) {
    return (
      <p className="text-sm text-muted-foreground">
        This plugin has no configurable settings.
      </p>
    );
  }

  async function handleSave() {
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
    <div className="space-y-2">
      {Object.entries(schema.properties).map(([propKey, propSchema]) => (
        <PrimitiveField
          key={propKey}
          pluginId={pluginId}
          propKey={propKey}
          schema={propSchema}
          value={draft[propKey]}
          onChange={(v) => setDraft((d) => ({ ...d, [propKey]: v }))}
        />
      ))}
      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving}>
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
