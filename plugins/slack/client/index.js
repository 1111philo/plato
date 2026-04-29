/**
 * Slack plugin — client side.
 *
 * Registers the SlackSettingsPanel as the `adminSettingsPanel` slot. Plato's
 * <PluginSlot name="adminSettingsPanel"> renders this inside the Integrations card.
 */

import SlackSettingsPanel from './SlackSettingsPanel.jsx';

export default {
  slots: {
    adminSettingsPanel: SlackSettingsPanel,
  },
};
