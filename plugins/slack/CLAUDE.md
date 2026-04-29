# plugins/slack/ — Claude / agent instructions

This plugin ships in plato core (`builtIn: true`). It lets admins invite learners via Slack DM.

## Local invariants
- The bot token is `writeOnly` in `settingsSchema` — never echo it back in a `GET` response. The plugin's settings record holds it; the `/v1/plugins` endpoint strips writeOnly fields for non-admin callers.
- Settings live at `_system:plugins:activation.slack.settings`. Don't write to the legacy `_system:settings.slack` location — `onActivate` migrates that on first boot, then leaves it alone.
- The Bolt SDK (`@slack/web-api`) stays in `server/package.json` because the plugin folder gets bundled into the same Lambda and shares its node_modules.
- All admin routes are mounted under `/v1/plugins/slack/admin/*`. Don't re-register Slack routes on the core `admin` router.

## When changing this plugin
- If you change the manifest's `capabilities`, update `docs/plugins/CAPABILITIES.md` if you add a new capability not yet in the vocabulary.
- If you add a new slot or hook, declare it in `extensionPoints` AND in `capabilities` — the registry will reject the plugin otherwise (`plugin_capability_missing`).
- Test changes locally with `node dev-sqlite.js` before pushing — the plugin host runs in dev exactly like prod.
