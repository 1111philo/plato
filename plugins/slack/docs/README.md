# Slack plugin

plato plugin that adds Slack DM invites for the learner-onboarding flow.

## Setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps).
2. Add OAuth scopes: `users:read`, `users:read.email`, `channels:read`, `groups:read`, `chat:write`, `im:write`.
3. Install to your workspace, copy the **Bot User OAuth Token** (starts with `xoxb-`).
4. In plato, go to **Admin → Plugins → Slack**, paste the token, click **Test Connection**, then **Connect**.
5. The Invite Users dialog on the Users page now shows a Slack tab.

## Settings

| Field | Type | Notes |
|---|---|---|
| `botToken` | string (writeOnly) | Stored encrypted at rest in DynamoDB. |
| `workspaceName` | string | Display name; populated on successful test. |
| `connected` | boolean | True once auth.test succeeds. |

## Routes (admin-only)

- `POST /v1/plugins/slack/admin/test` — validate a bot token (no persistence)
- `GET  /v1/plugins/slack/admin/users?q=` — search workspace users
- `GET  /v1/plugins/slack/admin/channels` — list public channels
- `GET  /v1/plugins/slack/admin/channels/:id/members` — list channel members
- `POST /v1/plugins/slack/admin/invites` — send DMs (max 200 per batch)

## Disabling

Toggle off in **Admin → Plugins → Slack**. The plugin's routes return 404 while disabled and the row-action button hides on the Users page. Settings are preserved — re-enabling restores the previous bot token.
