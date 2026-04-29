import { useState, useEffect, useCallback, createElement } from 'react';
import { adminApi } from './adminApi.js';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { initPluginRegistry, settingsPanelFor, refreshActivation } from '@/lib/plugins/registry.js';
import SettingsForm from '@/lib/plugins/SettingsForm.jsx';

/**
 * Plugins page — one card per installed plugin. Settings panel renders inline
 * when the plugin is enabled (matches WordPress / Shopify Apps patterns —
 * disabled plugins are subdued, enabled ones expose their controls inline so
 * admins can verify state at a glance).
 */

export default function AdminPlugins() {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [registryReady, setRegistryReady] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await adminApi('GET', '/v1/admin/plugins');
      setPlugins(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Plugins — plato';
    load();
    initPluginRegistry().then(() => setRegistryReady(true));
  }, [load]);

  async function toggle(pluginId, enabled) {
    try {
      await adminApi('PUT', `/v1/admin/plugins/${pluginId}/activation`, { enabled });
      await refreshActivation();
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveSettings(pluginId, next) {
    await adminApi('PUT', `/v1/admin/plugins/${pluginId}/settings`, next);
    await refreshActivation();
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Plugins</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enable, disable, and configure plato plugins.{' '}
        <a href="https://github.com/1111philo/plato/blob/main/docs/plugins/AUTHORING.md" target="_blank" rel="noopener noreferrer" className="underline">
          Build your own.
        </a>
      </p>

      {plugins.length === 0 && (
        <p className="text-sm text-muted-foreground">No plugins installed.</p>
      )}

      <div className="space-y-4">
        {plugins.map((plugin) => (
          <PluginCard
            key={plugin.id}
            plugin={plugin}
            registryReady={registryReady}
            onToggle={(enabled) => toggle(plugin.id, enabled)}
            onSaveSettings={(next) => saveSettings(plugin.id, next)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Accessible toggle styled as a switch. Implements the WAI-ARIA `switch` pattern:
 * focusable button with `role="switch"` and `aria-checked`. Click and Space
 * toggle. Wrapped here (rather than added to components/ui) since it's the
 * only consumer today; promote later if reused.
 */
function Switch({ checked, onCheckedChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function PluginCard({ plugin, registryReady, onToggle, onSaveSettings }) {
  const customPanel = registryReady ? settingsPanelFor(plugin.id) : null;
  const hasSettingsSurface = !!customPanel || !!plugin.settingsSchema;
  const isDisabled = !plugin.enabled;
  const hasLoadError = !!plugin.loadError;

  return (
    <Card className={cn('transition-opacity', isDisabled && !hasLoadError && 'opacity-75')}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-none">{plugin.name}</h2>
              <span className="text-xs text-muted-foreground">v{plugin.version}</span>
              {plugin.builtIn && <Badge variant="secondary" className="text-xs">Built-in</Badge>}
              {hasLoadError && <Badge variant="destructive" className="text-xs">Load error</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{plugin.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn('text-xs font-medium', plugin.enabled ? 'text-foreground' : 'text-muted-foreground')}>
              {plugin.enabled ? 'On' : 'Off'}
            </span>
            <Switch
              checked={!!plugin.enabled}
              onCheckedChange={onToggle}
              disabled={hasLoadError}
              label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
            />
          </div>
        </div>
      </CardHeader>

      {plugin.enabled && hasSettingsSurface && (
        <CardContent className="pt-0">
          <Separator className="mb-4" />
          {customPanel
            ? createElement(customPanel, {
                pluginId: plugin.id,
                settings: plugin.settings || {},
                onSave: onSaveSettings,
              })
            : (
              <SettingsForm
                pluginId={plugin.id}
                schema={plugin.settingsSchema}
                settings={plugin.settings || {}}
                onSave={onSaveSettings}
              />
            )}
        </CardContent>
      )}

      {Array.isArray(plugin.capabilities) && plugin.capabilities.length > 0 && (
        <CardContent className="pt-0">
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
              <span className="group-open:hidden">Show {plugin.capabilities.length} permission{plugin.capabilities.length === 1 ? '' : 's'}</span>
              <span className="hidden group-open:inline">Hide permissions</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-1">
              {plugin.capabilities.map((cap) => (
                <code key={cap} className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{cap}</code>
              ))}
            </div>
          </details>
        </CardContent>
      )}

      {hasLoadError && (
        <CardContent className="pt-0">
          <p role="alert" className="text-sm text-destructive">
            <strong>Failed to load:</strong> {plugin.loadError}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
