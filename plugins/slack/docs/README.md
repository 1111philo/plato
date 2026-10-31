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
| `autoInviteEnabled` | boolean | Add new plato accounts to a channel (#379). Off by default. |
| `autoInviteChannelId` / `autoInviteChannelName` | string | The channel for auto-invite. |

## Add new accounts to a channel (#379)

When it's on, every new plato account (the `userCreated` hook) is looked up
in the workspace **by email**. A member is added to the chosen channel with
`conversations.invite`. plato doesn't send workspace invitations, so someone
not in the workspace is recorded as "Not in the workspace".

- **Scopes:** `users:read.email`, plus `channels:manage` for a public channel
  or `groups:write` for a private one. The app must be in the channel.
- **Results** are kept per user in `userMeta:slack.autoInvite`
  (`invited` / `not_in_workspace` / `failed`, with Slack's error code). The
  settings panel lists recent results with **Retry**, and **Retry everyone
  not added** picks up people who joined the workspace later.
- **Never twice:** someone already added to the current channel is skipped,
  and Slack's `already_in_channel` counts as done.
- **Signup waits for the invite** (each Slack call gets one 4 s try). On
  Lambda nothing may run after the response is sent, so the result is always
  recorded before signup finishes; a timeout shows as Failed, with Retry.

## Routes (admin-only)

- `POST /v1/plugins/slack/admin/test` — validate a bot token (no persistence)
- `GET  /v1/plugins/slack/admin/users?q=` — search workspace users
- `GET  /v1/plugins/slack/admin/channels` — list public channels
- `GET  /v1/plugins/slack/admin/channels/:id/members` — list channel members
- `POST /v1/plugins/slack/admin/invites` — send DMs (max 200 per batch)
- `GET  /v1/plugins/slack/admin/auto-invite` — recent auto-invite results
- `POST /v1/plugins/slack/admin/auto-invite/retry` — `{ userId }` or `{ all: true }`

## Disabling

Toggle off in **Admin → Plugins → Slack**. The plugin's routes return 404 while disabled and the row-action button hides on the Users page. Settings are preserved — re-enabling restores the previous bot token.
