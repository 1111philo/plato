/**
 * Microsoft Entra SSO plugin — client side.
 *
 * Registers EntraSettingsPanel as the `adminSettingsPanel` slot, rendered
 * inside the plugin card on /plato/plugins.
 */

import EntraSettingsPanel from './EntraSettingsPanel.jsx';

export default {
  slots: {
    adminSettingsPanel: EntraSettingsPanel,
  },
};
