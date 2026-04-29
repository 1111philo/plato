/**
 * Vite-time plugin discovery. `import.meta.glob` with `eager: true` causes Vite to
 * statically include every match in the bundle; we get back a synchronous map
 * once the bundle is loaded. Same pattern Astro and SvelteKit use for plugin
 * discovery.
 *
 * Plugin folders live at <repo-root>/plugins/<id>/. From this file
 * (client/src/lib/plugins/loader.js) the relative path is ../../../../plugins.
 *
 * server.fs.allow in vite.config.js is set to the repo root so dev mode can
 * serve files outside client/.
 */

const manifestModules = import.meta.glob('../../../../plugins/*/plugin.json', {
  eager: true,
  import: 'default',
});

const clientModules = import.meta.glob('../../../../plugins/*/client/index.js', {
  eager: true,
});

function idFromPath(path) {
  // path like '../../../../plugins/slack/plugin.json'
  const m = path.match(/\/plugins\/([^/]+)\//);
  return m ? m[1] : null;
}

export async function discoverPlugins() {
  const manifests = {};
  const modules = {};
  for (const [path, manifest] of Object.entries(manifestModules)) {
    const id = idFromPath(path);
    if (!id || !manifest || typeof manifest !== 'object') continue;
    manifests[id] = manifest;
  }
  for (const [path, mod] of Object.entries(clientModules)) {
    const id = idFromPath(path);
    if (!id) continue;
    modules[id] = mod;
  }
  return { manifests, modules };
}
