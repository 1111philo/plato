import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedFetch } from '../../../client/js/auth.js';
import {
  RESET_OPTIONS,
  createDefaultRule,
  normalizeRewardRules,
  validateRewardRules,
} from './rule-utils.js';

const selectClass = 'h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:bg-input/50 disabled:opacity-50';

function initialRules(settings) {
  if (Array.isArray(settings.rules)) return normalizeRewardRules(settings.rules);
  return [createDefaultRule()];
}

function createRuleId(rules) {
  const used = new Set((rules || []).map((rule) => rule.id));
  let index = used.size + 1;
  let id = `reward-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `reward-${index}`;
  }
  return id;
}

function fieldId(rule, field) {
  return `openrouter-${rule.id}-${field}`;
}

function RuleInput({ rule, field, label, type = 'text', value, onChange, ...props }) {
  const id = fieldId(rule, field);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </div>
  );
}

function RuleSelect({ rule, field, label, value, onChange, children }) {
  const id = fieldId(rule, field);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {children}
      </select>
    </div>
  );
}

function RewardRuleEditor({ rule, index, onChange, onDuplicate, onRemove }) {
  const valueLabel = rule.trigger === 'specific-lesson' ? 'Lesson ID' : 'Completed lessons';
  const valueType = rule.trigger === 'specific-lesson' ? 'text' : 'number';
  const valueProps = rule.trigger === 'specific-lesson'
    ? { placeholder: 'lesson-id' }
    : { min: '1', step: '1' };

  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium">Rule {index + 1}</span>
          <Badge variant={rule.enabled ? 'secondary' : 'outline'} className="text-xs">
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} aria-label={`Duplicate rule ${index + 1}`}>
            Copy
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove rule ${index + 1}`}>
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <RuleInput rule={rule} field="name" label="Name" value={rule.name} onChange={(value) => onChange('name', value)} />
        <RuleSelect rule={rule} field="trigger" label="Trigger" value={rule.trigger} onChange={(value) => onChange('trigger', value)}>
          <option value="lesson-count">Completed lesson count</option>
          <option value="specific-lesson">Specific lesson</option>
        </RuleSelect>
        <RuleInput
          rule={rule}
          field="value"
          label={valueLabel}
          type={valueType}
          value={rule.value}
          onChange={(value) => onChange('value', value)}
          {...valueProps}
        />
        <RuleInput
          rule={rule}
          field="creditAmount"
          label="Credit amount"
          type="number"
          value={rule.creditAmount}
          onChange={(value) => onChange('creditAmount', value)}
          min="0.01"
          step="0.01"
        />
        <RuleSelect rule={rule} field="limitReset" label="Reset cadence" value={rule.limitReset || ''} onChange={(value) => onChange('limitReset', value || null)}>
          {RESET_OPTIONS.map((option) => (
            <option key={option.value || 'none'} value={option.value}>{option.label}</option>
          ))}
        </RuleSelect>
        <RuleInput
          rule={rule}
          field="expiresAfterDays"
          label="Expires after days"
          type="number"
          value={rule.expiresAfterDays ?? ''}
          onChange={(value) => onChange('expiresAfterDays', value)}
          min="1"
          step="1"
          placeholder="Never"
        />
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onChange('enabled', e.target.checked)}
        />
        <span>Enabled</span>
      </label>
    </section>
  );
}

export default function AdminSettingsPanel({ settings = {}, onSave }) {
  const [managementKey, setManagementKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState(settings.workspaceId || '');
  const [rules, setRules] = useState(() => initialRules(settings));
  const [slackDmEnabled, setSlackDmEnabled] = useState(settings.delivery?.slackDmEnabled === true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);

  function updateRule(id, field, value) {
    setRules((current) => current.map((rule) => {
      if (rule.id !== id) return rule;
      const next = { ...rule, [field]: value };
      if (field === 'trigger') {
        next.value = value === 'lesson-count' ? 1 : '';
      }
      return next;
    }));
  }

  function addRule() {
    setRules((current) => [...current, createDefaultRule(createRuleId(current))]);
  }

  function duplicateRule(rule) {
    setRules((current) => [
      ...current,
      {
        ...rule,
        id: createRuleId(current),
        name: `${rule.name || 'Reward rule'} copy`,
      },
    ]);
  }

  function removeRule(id) {
    setRules((current) => current.filter((rule) => rule.id !== id));
  }

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
      const next = {
        workspaceId: workspaceId.trim(),
        rules: validateRewardRules(rules),
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
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
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
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Reward rules</h3>
          <Button type="button" variant="outline" size="sm" onClick={addRule}>
            + Add rule
          </Button>
        </div>
        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No reward rules.
            </div>
          ) : rules.map((rule, index) => (
            <RewardRuleEditor
              key={rule.id}
              rule={rule}
              index={index}
              onChange={(field, value) => updateRule(rule.id, field, value)}
              onDuplicate={() => duplicateRule(rule)}
              onRemove={() => removeRule(rule.id)}
            />
          ))}
        </div>
      </section>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={slackDmEnabled}
          onChange={(e) => setSlackDmEnabled(e.target.checked)}
          className="mt-1"
        />
        <span>Send keys through Slack when Slack is configured.</span>
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
