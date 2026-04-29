/**
 * <PluginSlot name="..." context={{ ... }} />
 *
 * Renders every enabled plugin's component for the named slot. Host owns
 * placement; plugins own content. The `context` prop is spread to each
 * component, so host-defined props (e.g. `user` for adminUserRowAction)
 * are passed through directly.
 *
 * Lazy-initializes the registry on first mount of any slot.
 */

import { useEffect, useState, Fragment } from 'react';
import { initPluginRegistry, slotComponents } from './registry.js';

let registryLoaded = false;
let registryPromise = null;

export function PluginSlot({ name, context = {}, fallback = null }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (registryLoaded) return;
    if (!registryPromise) {
      registryPromise = initPluginRegistry().then(() => {
        registryLoaded = true;
        force((n) => n + 1);
      });
    } else {
      registryPromise.then(() => force((n) => n + 1));
    }
  }, []);

  if (!registryLoaded) return fallback;

  const components = slotComponents(name);
  if (components.length === 0) return fallback;

  return (
    <>
      {components.map(({ pluginId, Component }) => (
        <Fragment key={pluginId}>
          <Component pluginId={pluginId} {...context} />
        </Fragment>
      ))}
    </>
  );
}

export default PluginSlot;
