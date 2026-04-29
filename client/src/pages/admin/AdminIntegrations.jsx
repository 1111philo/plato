import { useState, useEffect, useCallback, createElement } from 'react';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { initPluginRegistry, settingsPanelFor, refreshActivation } from '@/lib/plugins/registry.js';
import SettingsForm from '@/lib/plugins/SettingsForm.jsx';

/**
 * Integrations page — generic plugin list. One card per installed plugin.
 *
 * Each card shows:
 *   - Name, version, capability chips, "Built-in" badge if applicable
 *   - Enable/disable toggle
 *   - Settings panel: either the plugin's own `adminSettingsPanel` slot, or
 *     SettingsForm auto-rendered from the manifest's settingsSchema, or nothing
 *     when the plugin has no settings.
 */

export default function AdminIntegrations() {
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
    document.title = 'Integrations — plato';
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
      <h1 className="text-2xl font-bold mb-2">Integrations</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Connect external services and extend plato. Each plugin declares the capabilities it uses
        — disabled plugins consume zero runtime surface. New to plugins?{' '}
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

function PluginCard({ plugin, registryReady, onToggle, onSaveSettings }) {
  const [expanded, setExpanded] = useState(false);
  const customPanel = registryReady ? settingsPanelFor(plugin.id) : null;
  const hasSettingsSurface = !!customPanel || !!plugin.settingsSchema;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <span>{plugin.name}</span>
              <span className="text-xs font-normal text-muted-foreground">v{plugin.version}</span>
              {plugin.builtIn && <Badge variant="secondary">Built-in</Badge>}
              {plugin.loadError && <Badge variant="destructive">Load error</Badge>}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{plugin.description}</p>
            {Array.isArray(plugin.capabilities) && plugin.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {plugin.capabilities.map((cap) => (
                  <Badge key={cap} variant="outline" className="text-xs">{cap}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!plugin.enabled}
                onChange={(e) => onToggle(e.target.checked)}
                aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                disabled={!!plugin.loadError}
              />
              <span>{plugin.enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        </div>
      </CardHeader>
      {plugin.enabled && hasSettingsSurface && (
        <CardContent>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mb-3"
          >
            {expanded ? 'Hide settings' : 'Show settings'}
          </Button>
          {expanded && (
            <div className="border-t pt-4">
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
            </div>
          )}
        </CardContent>
      )}
      {plugin.loadError && (
        <CardContent>
          <p role="alert" className="text-sm text-destructive">
            <strong>Failed to load:</strong> {plugin.loadError}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
