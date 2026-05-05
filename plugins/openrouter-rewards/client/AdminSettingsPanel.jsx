import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authenticatedFetch } from '../../../client/js/auth.js';

const defaultRules = [
  {
    id: 'first-lesson',
    name: 'First lesson',
    enabled: true,
    trigger: 'lesson-count',
    value: 1,
    creditAmount: 1,
    limitReset: 'monthly',
    expiresAfterDays: null,
  },
];

export default function AdminSettingsPanel({ settings = {}, onSave }) {
  const [managementKey, setManagementKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState(settings.workspaceId || '');
  const [rulesText, setRulesText] = useState(JSON.stringify(settings.rules || defaultRules, null, 2));
  const [slackDmEnabled, setSlackDmEnabled] = useState(settings.delivery?.slackDmEnabled === true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await authenticatedFetch('/v1/plugins/openrouter-rewards/admin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managementKey: managementKey.trim() || undefined,
          workspaceId: workspaceId.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Connection failed');
      setMessage({ type: 'success', text: 'OpenRouter connection works.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const rules = JSON.parse(rulesText || '[]');
      const next = {
        workspaceId: workspaceId.trim(),
        rules,
        delivery: { inAppReveal: true, slackDmEnabled },
        reissueCooldownHours: Number(settings.reissueCooldownHours || 24),
        keyNameTemplate: settings.keyNameTemplate || 'plato:{classroomName}:{userEmail}',
      };
      if (managementKey.trim()) next.managementKey = managementKey.trim();
      await onSave(next);
      setManagementKey('');
      setMessage({ type: 'success', text: 'OpenRouter Rewards saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="openrouter-management-key">Management key</Label>
        <Input
          id="openrouter-management-key"
          type="password"
          value={managementKey}
          onChange={(e) => setManagementKey(e.target.value)}
          placeholder={settings.workspaceId ? 'Leave blank to keep saved key' : 'sk-or-...'}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="openrouter-workspace-id">Workspace ID</Label>
        <Input id="openrouter-workspace-id" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="openrouter-rules">Reward rules JSON</Label>
        <Textarea id="openrouter-rules" value={rulesText} onChange={(e) => setRulesText(e.target.value)} rows={8} className="font-mono text-xs" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={slackDmEnabled}
          onChange={(e) => setSlackDmEnabled(e.target.checked)}
          className="mt-1"
        />
        <span>Send keys through Slack when Slack is configured. Slack may retain the message according to your workspace retention policy.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleTest} disabled={testing || (!managementKey.trim() && !settings.workspaceId)}>
          {testing ? 'Testing...' : 'Test connection'}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save rewards'}
        </Button>
      </div>
      {message && (
        <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
