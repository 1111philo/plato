/**
 * Plugin registry. Singleton.
 *
 * Lifecycle:
 *   1. boot() — scan plugins/<id>/ directories, validate every manifest, dynamic-import
 *      enabled plugins' server modules, run onActivate, register hook subscriptions.
 *   2. setEnabled(id, enabled) — flip activation state in memory + persist to
 *      _system:plugins:activation. Runs onActivate/onDeactivate. The catch-all
 *      route handler in server/src/index.js checks entry.enabled per request.
 *   3. updateSettings(id, next) — persist plugin-specific settings; updates live
 *      view so the next request sees the new values.
 *
 * Where it's called:
 *   - server/src/index.js calls boot() in the first-request init block.
 *   - server/src/routes/admin.js calls setEnabled / updateSettings via PUT endpoints.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import db from '../db.js';
import { logger } from '../logger.js';
import { validateManifest } from './manifest.js';
import { satisfies, PLUGIN_API_VERSION } from './version.js';
import { on as hookOn, emit as hookEmit } from './hooks.js';
import { invokeOnActivate, invokeOnDeactivate, invokeOnUninstall } from './lifecycle.js';
import { createPluginLogger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dual-path discovery, mirrors seed.js. From server/src/lib/plugins/:
//   - local dev: ../../../../plugins  (up 4: plugins -> lib -> src -> server -> repo -> plugins/)
//   - Lambda:    ../../../plugins     (up 3: plugins -> lib -> src -> function root -> plugins/)
function findPluginsDir() {
  const candidates = [
    join(__dirname, '../../../../plugins'),
    join(__dirname, '../../../plugins'),
  ];
  for (const path of candidates) {
    if (existsSync(path) && statSync(path).isDirectory()) return path;
  }
  return null;
}

const ACTIVATION_KEY = 'plugins:activation';

/** In-memory registry state. Reset by tests via _reset(). */
const state = {
  pluginsDir: null,
  // id -> { manifest, dir, serverModule|null, enabled, settings, loadError|null, hookUnsubs: Function[] }
  entries: new Map(),
  booted: false,
};

function db_view() {
  return {
    getUserById: (id) => db.getUserById(id),
    listAllUsers: () => db.listAllUsers(),
  };
}

async function readActivation() {
  const item = await db.getSyncData('_system', ACTIVATION_KEY);
  return { record: (item?.data && typeof item.data === 'object') ? item.data : {}, version: item?.version || 0 };
}

async function writeActivation(record, version) {
  await db.putSyncData('_system', ACTIVATION_KEY, record, version);
}

/** Discover candidate plugin folders. Each must contain plugin.json. */
function discoverPluginFolders(pluginsDir) {
  if (!pluginsDir || !existsSync(pluginsDir)) return [];
  const out = [];
  for (const entry of readdirSync(pluginsDir)) {
    const dir = join(pluginsDir, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(dir, 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    out.push({ id: entry, dir, manifestPath });
  }
  return out;
}

function loadManifest(manifestPath, expectedId) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return { ok: false, errors: [`failed to parse plugin.json: ${err.message}`] };
  }
  return validateManifest(raw, { expectedId });
}

/** Build a context object for hooks/lifecycle invocations. */
function buildContext(id, settings) {
  return {
    pluginId: id,
    logger: createPluginLogger(id),
    db: db_view(),
    settings: settings || {},
    setSettings: async (next) => {
      await pluginRegistry.updateSettings(id, next);
    },
    emit: (event, payload) => hookEmit(event, payload),
  };
}

/** Register a plugin's hook subscriptions (returns an array of unsub fns). */
function subscribeHooks(id, plugin) {
  const subs = [];
  if (!plugin || !plugin.hooks || typeof plugin.hooks !== 'object') return subs;
  for (const [event, fn] of Object.entries(plugin.hooks)) {
    if (typeof fn !== 'function') continue;
    const wrapped = (payload) => {
      const entry = state.entries.get(id);
      // Gate hook execution on enabled state — disabled plugins must produce zero side effects.
      if (!entry?.enabled) return;
      const ctx = buildContext(id, entry.settings);
      return fn(payload, ctx);
    };
    subs.push(hookOn(event, wrapped, { pluginId: id }));
  }
  return subs;
}

async function dynamicImportServer(dir, manifest) {
  // Default location is server/index.js unless extensionPoints.serverRoutes points elsewhere.
  // Even plugins that only export hooks or onActivate/onDeactivate live in server/index.js.
  const ref = manifest.extensionPoints?.serverRoutes;
  const filePath = ref ? join(dir, ref.split('#')[0]) : join(dir, 'server/index.js');
  if (!existsSync(filePath)) {
    if (ref) throw new Error(`serverRoutes file not found: ${filePath}`);
    return null; // Pure-client plugin
  }
  const mod = await import(pathToFileURL(filePath).href);
  return mod.default || mod;
}

export const pluginRegistry = {
  /**
   * Discover, validate, dynamic-import, and activate enabled plugins.
   * Idempotent — safe to call once at first request.
   */
  async boot() {
    if (state.booted) return;
    state.booted = true;
    state.pluginsDir = findPluginsDir();
    if (!state.pluginsDir) {
      logger.warn('plugin_dir_not_found', { searched: 'plugins/' });
      return;
    }

    let activation;
    try {
      activation = await readActivation();
    } catch (err) {
      logger.error('plugin_activation_read_failed', { error: err?.message });
      activation = { record: {}, version: 0 };
    }

    for (const folder of discoverPluginFolders(state.pluginsDir)) {
      try {
        const result = loadManifest(folder.manifestPath, folder.id);
        if (!result.ok) {
          logger.error('plugin_manifest_invalid', { pluginId: folder.id, errors: result.errors });
          state.entries.set(folder.id, {
            manifest: null,
            dir: folder.dir,
            serverModule: null,
            enabled: false,
            settings: {},
            loadError: result.errors.join('; '),
            hookUnsubs: [],
          });
          continue;
        }
        const manifest = result.manifest;

        if (!satisfies(PLUGIN_API_VERSION, manifest.apiVersion)) {
          logger.error('plugin_api_mismatch', {
            pluginId: manifest.id,
            host: PLUGIN_API_VERSION,
            requested: manifest.apiVersion,
          });
          state.entries.set(manifest.id, {
            manifest,
            dir: folder.dir,
            serverModule: null,
            enabled: false,
            settings: {},
            loadError: `apiVersion ${manifest.apiVersion} not satisfied by host ${PLUGIN_API_VERSION}`,
            hookUnsubs: [],
          });
          continue;
        }

        const persisted = activation.record[manifest.id] || {};
        const hasStoredState = manifest.id in activation.record;
        const enabled = typeof persisted.enabled === 'boolean'
          ? persisted.enabled
          : Boolean(manifest.defaultEnabled);
        const settings = (persisted.settings && typeof persisted.settings === 'object') ? persisted.settings : {};

        let serverModule = null;
        try {
          serverModule = await dynamicImportServer(folder.dir, manifest);
        } catch (err) {
          logger.error('plugin_load_failed', { pluginId: manifest.id, error: err?.message, stack: err?.stack });
          state.entries.set(manifest.id, {
            manifest,
            dir: folder.dir,
            serverModule: null,
            enabled: false,
            settings,
            loadError: err?.message || String(err),
            hookUnsubs: [],
          });
          continue;
        }

        const entry = {
          manifest,
          dir: folder.dir,
          serverModule,
          enabled,
          settings,
          hasStoredState,
          loadError: null,
          hookUnsubs: [],
        };
        state.entries.set(manifest.id, entry);

        if (enabled) {
          entry.hookUnsubs = subscribeHooks(manifest.id, serverModule);
          await invokeOnActivate(serverModule, buildContext(manifest.id, settings));
        }
        logger.warn('plugin_loaded', { pluginId: manifest.id, enabled });
      } catch (err) {
        logger.error('plugin_load_failed', { pluginId: folder.id, error: err?.message, stack: err?.stack });
      }
    }
  },

  /** Returns the in-memory entry (or undefined). */
  get(id) {
    return state.entries.get(id);
  },

  /** All entries (for /v1/admin/plugins). */
  list() {
    return [...state.entries.values()];
  },

  /**
   * Re-read the activation record from DynamoDB and reconcile this container's
   * in-memory entry with it. Fixes the cross-Lambda staleness where Container A
   * handled the admin's enable-toggle (updating its own state + DB) while
   * Container B — booted before the toggle — kept serving requests with
   * `enabled: false` and returning "Plugin disabled" 404s from the dispatcher.
   *
   * Called by the dispatcher on every plugin route hit. Cheap (one GetItem)
   * and plato's plugin traffic is low. If a flip is detected, hooks are
   * (re)subscribed and onActivate/onDeactivate runs — same pattern as boot,
   * which the contract already requires plugins to tolerate (lifecycle.js).
   *
   * No-op when there's no entry, the plugin failed to load, or the DB read
   * fails — failures here must not knock the dispatcher offline.
   */
  async refreshActivation(id) {
    const entry = state.entries.get(id);
    if (!entry || !entry.manifest || entry.loadError) return entry;

    let activation;
    try {
      activation = await readActivation();
    } catch (err) {
      logger.error('plugin_activation_refresh_failed', { pluginId: id, error: err?.message });
      return entry;
    }

    const persisted = activation.record[id] || {};
    const hasStoredState = id in activation.record;
    const desiredEnabled = typeof persisted.enabled === 'boolean'
      ? persisted.enabled
      : Boolean(entry.manifest.defaultEnabled);
    const desiredSettings = (persisted.settings && typeof persisted.settings === 'object')
      ? persisted.settings
      : {};

    entry.settings = desiredSettings;
    entry.hasStoredState = hasStoredState;

    if (desiredEnabled === entry.enabled) return entry;

    entry.enabled = desiredEnabled;
    if (desiredEnabled) {
      entry.hookUnsubs = subscribeHooks(id, entry.serverModule);
      await invokeOnActivate(entry.serverModule, buildContext(id, entry.settings));
    } else {
      for (const unsub of entry.hookUnsubs) { try { unsub(); } catch { /* noop */ } }
      entry.hookUnsubs = [];
      await invokeOnDeactivate(entry.serverModule, buildContext(id, entry.settings));
    }
    logger.warn('plugin_activation_refreshed', { pluginId: id, enabled: desiredEnabled });
    return entry;
  },

  /** Toggle activation. Persists to sync-data and runs onActivate/onDeactivate. */
  async setEnabled(id, enabled) {
    const entry = state.entries.get(id);
    if (!entry) throw new Error(`unknown plugin: ${id}`);
    if (entry.loadError) throw new Error(`plugin "${id}" failed to load: ${entry.loadError}`);
    if (entry.enabled === enabled) return entry;

    const { record, version } = await readActivation();
    // Prefer freshly-read settings over local entry.settings — another Lambda
    // container may have just updated settings and our in-memory copy is stale.
    const persistedSettings = (record[id]?.settings && typeof record[id].settings === 'object')
      ? record[id].settings
      : entry.settings;
    record[id] = { enabled, settings: persistedSettings };
    await writeActivation(record, version);
    entry.settings = persistedSettings;

    entry.enabled = enabled;
    entry.hasStoredState = true;
    if (enabled) {
      entry.hookUnsubs = subscribeHooks(id, entry.serverModule);
      await invokeOnActivate(entry.serverModule, buildContext(id, entry.settings));
    } else {
      for (const unsub of entry.hookUnsubs) { try { unsub(); } catch { /* noop */ } }
      entry.hookUnsubs = [];
      await invokeOnDeactivate(entry.serverModule, buildContext(id, entry.settings));
    }
    return entry;
  },

  /**
   * Run the plugin's `onUninstall` hook to wipe its data, then clear the
   * plugin's activation entry. Plugin must already be disabled — refuses
   * otherwise so the admin commits to a deliberate two-step path
   * (disable first, then uninstall data).
   *
   * Errors from the plugin's onUninstall propagate to the caller — partial
   * cleanup is surfaced loudly rather than silently swallowed.
   */
  async uninstallData(id) {
    const entry = state.entries.get(id);
    if (!entry) throw new Error(`unknown plugin: ${id}`);
    if (entry.loadError) throw new Error(`plugin "${id}" failed to load: ${entry.loadError}`);
    if (entry.enabled) throw new Error(`plugin "${id}" must be disabled before uninstalling data`);

    // Run the plugin's teardown. Throws propagate.
    await invokeOnUninstall(entry.serverModule, buildContext(id, entry.settings));

    // Clear the plugin's settings + entry from the activation record so a
    // future re-enable starts fresh.
    const { record, version } = await readActivation();
    if (record[id]) {
      delete record[id];
      await writeActivation(record, version);
    }
    entry.settings = {};
    entry.hasStoredState = false;
    return entry;
  },

  /** Update plugin settings. Does NOT toggle activation. */
  async updateSettings(id, nextSettings) {
    const entry = state.entries.get(id);
    if (!entry) throw new Error(`unknown plugin: ${id}`);
    if (!nextSettings || typeof nextSettings !== 'object') {
      throw new Error('settings must be an object');
    }
    const { record, version } = await readActivation();
    // Prefer the persisted enabled state over local entry.enabled — another
    // Lambda container may have just toggled activation and this container's
    // in-memory copy is stale. Without this guard, a settings save from a
    // stale container would clobber a fresh enable back to disabled.
    const persistedEnabled = typeof record[id]?.enabled === 'boolean'
      ? record[id].enabled
      : entry.enabled;
    record[id] = { enabled: persistedEnabled, settings: nextSettings };
    await writeActivation(record, version);
    entry.settings = nextSettings;
    entry.enabled = persistedEnabled;
    entry.hasStoredState = true;
    return entry;
  },

  /** Public-shape view of a single plugin (for endpoints). */
  publicView(entry) {
    if (!entry) return null;
    if (!entry.manifest) {
      return { id: 'unknown', loadError: entry.loadError };
    }
    const m = entry.manifest;
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      capabilities: m.capabilities,
      slots: m.extensionPoints?.slots ? Object.keys(m.extensionPoints.slots) : [],
      hooks: m.extensionPoints?.hooks || [],
      hasSettingsSchema: !!m.settingsSchema,
      settingsSchema: m.settingsSchema || null,
      // True iff the plugin has an entry in `_system:plugins:activation`
      // (i.e. has been activated/configured at least once and may have
      // stored data). Drives the "Delete plugin data" button visibility:
      // never-activated plugins have nothing to delete, so the button hides.
      hasStoredState: !!entry.hasStoredState,
      enabled: !!entry.enabled,
      loadError: entry.loadError || null,
    };
  },

  /**
   * Strip settings fields marked `writeOnly: true` in the manifest's settingsSchema.
   * Used by every endpoint that returns plugin settings (admin and non-admin) so
   * secrets like Slack's bot token never leak in HTTP responses. The plugin author
   * declares the secret with `writeOnly: true`; the host enforces stripping here.
   */
  sanitizeSettings(entry) {
    const settings = { ...(entry?.settings || {}) };
    const props = entry?.manifest?.settingsSchema?.properties;
    if (props) {
      for (const [k, schema] of Object.entries(props)) {
        if (schema && schema.writeOnly) delete settings[k];
      }
    }
    return settings;
  },

  /** Test-only: clear state. Does NOT touch DB. */
  _reset() {
    state.pluginsDir = null;
    state.entries.clear();
    state.booted = false;
  },

  /** Test-only: inject a fully-formed entry. Does NOT touch DB. */
  _setEntry(id, entry) {
    state.entries.set(id, entry);
    state.booted = true;
  },
};

export default pluginRegistry;
