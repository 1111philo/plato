# plugins/slack/ — Claude / agent instructions

Lets admins invite learners via Slack DM, and adds new accounts to a chosen channel (`server/auto-invite.js`, the `userCreated` hook, #379).

## Local invariants
- The bot token is `writeOnly` in `settingsSchema` — never echo it back in a `GET` response. The plugin's settings record holds it; the `/v1/plugins` endpoint strips writeOnly fields for non-admin callers.
- Settings live at `_system:plugins:activation.slack.settings`. Don't write to the legacy `_system:settings.slack` location — `onActivate` migrates that on first boot, then leaves it alone.
- The Bolt SDK (`@slack/web-api`) stays in `server/package.json` because the plugin folder gets bundled into the same Lambda and shares its node_modules.
- All admin routes are mounted under `/v1/plugins/slack/admin/*`. Don't re-register Slack routes on the core `admin` router.
- The settings panel saves with `{ ...settings, … }`. The client never sees `botToken`, and the host keeps a writeOnly value the body leaves out (send `null` to clear it, as Disconnect does).
- Auto-invite never invites twice: check `userMeta:slack.autoInvite` for the current channel first, and treat `already_in_channel` as success.
- A workspace member found by auto-invite is linked on the user record (`user.slackUserId`, the Admin → Users "Slack linked" column). Never overwrite an existing link.
- Read the workspace member list only through `listSlackMembers` (`server/slack-client.js`): cached a minute per bot token, no retries, fails at once when Slack rate-limits. Routes answer a rate limit with 429 `slack_rate_limited` (`slackFailure`). Never call Slack from an admin route with the client's default retries — it waits out `retry-after` until the Lambda times out (the 2026-11-17 prod alarms).

## When changing this plugin
- If you change the manifest's `capabilities`, update `docs/plugins/CAPABILITIES.md` if you add a new capability not yet in the vocabulary.
- If you add a new slot or hook, declare it in `extensionPoints` AND in `capabilities` — the registry will reject the plugin otherwise (`plugin_capability_missing`).
- Test changes locally with `node dev-sqlite.js` before pushing — the plugin host runs in dev exactly like prod.
