/**
 * Client-side plugin registry. Holds the bundle of every plugin discovered by Vite's
 * import.meta.glob, intersected with the activation list fetched from the server.
 *
 * Server-side `/v1/plugins` returns enabled plugins + sanitized settings; we use it
 * to gate slot rendering and nav items.
 */

import { authenticatedFetch } from '../../../js/auth.js';
import { discoverPlugins } from './loader.js';

const state = {
  manifests: new Map(),     // id -> manifest (from bundle)
  modules: new Map(),       // id -> client module exports (slots, settingsPanel, navItems)
  enabled: new Map(),       // id -> { settings, capabilities, ...publicView }
  loaded: false,
  loadingPromise: null,
};

async function loadOnce() {
  if (state.loaded) return;
  if (state.loadingPromise) return state.loadingPromise;
  state.loadingPromise = (async () => {
    // Static bundle: every manifest + module Vite found.
    const { manifests, modules } = await discoverPlugins();
    for (const [id, manifest] of Object.entries(manifests)) state.manifests.set(id, manifest);
    for (const [id, mod] of Object.entries(modules)) state.modules.set(id, mod);

    // Live server view: which plugins are enabled, with sanitized settings.
    try {
      const res = await authenticatedFetch('/v1/plugins');
      if (res.ok) {
        const list = await res.json();
        for (const p of list) {
          if (p.enabled) state.enabled.set(p.id, p);
        }
      }
    } catch {
      // Auth not yet ready (e.g. login page) — slots simply won't render.
    }
    state.loaded = true;
  })();
  return state.loadingPromise;
}

/** Re-fetch the enabled list (after a toggle in admin). */
export async function refreshActivation() {
  try {
    const res = await authenticatedFetch('/v1/plugins');
    if (!res.ok) return;
    const list = await res.json();
    state.enabled.clear();
    for (const p of list) {
      if (p.enabled) state.enabled.set(p.id, p);
    }
  } catch { /* noop */ }
}

/**
 * Components registered for `slotName` across all *enabled* plugins.
 * Returns an array of `{ pluginId, Component }`.
 */
export function slotComponents(slotName) {
  const out = [];
  for (const [id] of state.enabled) {
    const mod = state.modules.get(id);
    const Component = mod?.default?.slots?.[slotName] || mod?.slots?.[slotName];
    if (Component) out.push({ pluginId: id, Component });
  }
  return out;
}

/** Settings panel for a single plugin (used by AdminIntegrations). */
export function settingsPanelFor(id) {
  const mod = state.modules.get(id);
  return mod?.default?.settingsPanel || mod?.settingsPanel || null;
}

export { loadOnce as initPluginRegistry };
