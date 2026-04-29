# Plato plugins — AI agent guide

This file is the entry point for any AI agent (Claude Code, Cursor, etc.) working on plato plugins. Read this before generating code. The recipes at the bottom are copy-paste-ready.

## Decision tree (run this first)

When asked to build/modify plato functionality, decide which surface area to touch:

```
┌─ Is the change inside plugins/<id>/?  ────────► PLUGIN PATH (this guide)
│
└─ Is the change in client/, server/, or docs/? ► CORE PATH (CLAUDE.md, CONTRIBUTING.md)
```

If the user's request implies plugin work but you'd need to modify core, **stop**. See "Extension gaps" below.

## Step 1 — Inventory existing extension points

Before writing code, query the inventory:

```bash
# Machine-readable (preferred for agents)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/plugins/extension-points

# Or grep the human reference
grep -E "^## " docs/plugins/EXTENSION_REFERENCE.md
```

The endpoint returns: every slot name + props, every defined hook + payload, every capability, the host's API version, and links back to the source files.

## Step 2 — Compose existing surface area before requesting new

The single biggest agent failure mode is "I need a new slot/hook" when the existing surface already supports the feature. Examples:

| The need | Phase-1 way to do it |
|---|---|
| Show plugin status on the learner home page | Store config in plugin settings, add a polling route, no new slot needed |
| Track per-lesson plugin data | Store as `{ lessonId: data }` map under plugin settings until Phase 3's `plugin:<id>:*` sync-data namespace lands |
| React to a learner completing a lesson | Plugins can `on('lesson.<plugin-id>.completed', ...)` on the open bus today; core's `lessonCompleted` emit-point lands in Phase 2 |
| Add a per-user field | Stored in plugin settings keyed by userId until Phase 2's user-metadata extension lands |

## Step 3 — Use the open hook bus for plugin-to-plugin extensibility

`server/src/lib/plugins/hooks.js` is open: any event name works. Convention:
- `<plugin-id>.<event>` for plugin-emitted events (e.g., `slack.invite-sent`)
- bare names for core-emitted events (e.g., `userCreated`)

This means plugin A can extend plugin B without core involvement. Don't wait on core to add a new hook if you can publish/subscribe between plugins.

## Step 4 — Extension gaps: what to do when the surface area genuinely doesn't exist

If you cannot do the work without a new slot/hook/capability, **stop generating plugin code** and:

1. Mark the partially-built plugin file with `// [blocked-on-extension-point: <name>]` at the top.
2. File an extension-point request via `.github/ISSUE_TEMPLATE/extension-point-request.yml` (or instruct the user to). Include:
   - What slot/hook is needed
   - Where it would emit (server file:line) or render (client component slot)
   - The signature you'd want
   - A link to your plugin
3. Do NOT patch core files from inside `plugins/<id>/`. Do NOT add new contribution points by editing `server/src/lib/plugins/*` from a plugin folder.

The pilot agent is explicitly told not to claim extension-point requests — they require maintainer judgment on the public plugin contract.

## DO NOT — anti-goals (these will fail review)

- ❌ Mutate `lessonKB.status` directly (the coach completion path is the only owner)
- ❌ Introduce hard exchange-count cutoffs (extending the lesson is fine, force-completing is not)
- ❌ Bypass capability checks by importing core modules directly (use `server/src/lib/plugins/sdk.js`)
- ❌ Write to `_system:settings.*` (use `ctx.setSettings()` or `PUT /v1/admin/plugins/<id>/settings`)
- ❌ Read or write another plugin's settings record
- ❌ Modify files outside `plugins/<id>/` from inside a plugin (CLAUDE.md scope)
- ❌ Re-export or shadow core API endpoints under your plugin's prefix
- ❌ Block boot — keep `onActivate` short; if you need expensive work, schedule it via setTimeout(0)

## Recipes (copy-paste-ready)

### Recipe 1 — minimal plugin with a settings page

```bash
node scripts/create-plato-plugin.js my-plugin
```

That's it. The scaffolder generates a manifest with `adminSettingsPanel`, a working server route, a settings panel with one boolean checkbox, and a per-plugin `CLAUDE.md`. Customize from there.

### Recipe 2 — add a server route

```js
// plugins/<id>/server/index.js
import { Hono, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

routes.get('/admin/things', async (c) => {
  return c.json([{ id: 'a', name: 'thing' }]);
});

export default {
  routes,
  async onActivate(ctx) { ctx.logger.info('activated'); },
};
```

Manifest must include `"server.routes"` in `capabilities` and `"serverRoutes": "server/index.js#default"` in `extensionPoints`.

### Recipe 3 — read/write plugin settings from a route

```js
import { Hono, db, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

routes.get('/admin/settings', async (c) => {
  const item = await db.getSyncData('_system', 'plugins:activation');
  const settings = item?.data?.['<id>']?.settings || {};
  return c.json(settings);
});

export default { routes };
```

### Recipe 4 — settings page (custom UI)

```jsx
// plugins/<id>/client/SettingsPanel.jsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SettingsPanel({ settings, onSave }) {
  const [endpoint, setEndpoint] = useState(settings?.endpoint || '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-3">
      <Label htmlFor="endpoint">Endpoint URL</Label>
      <Input id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
      <Button
        onClick={async () => {
          setSaving(true);
          try { await onSave({ endpoint }); }
          finally { setSaving(false); }
        }}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
```

```js
// plugins/<id>/client/index.js
import SettingsPanel from './SettingsPanel.jsx';
export default { slots: { adminSettingsPanel: SettingsPanel } };
```

### Recipe 5 — fallback settings UI from JSON Schema

If you don't want to write a custom panel, declare `settingsSchema` in `plugin.json`:

```json
"settingsSchema": {
  "type": "object",
  "properties": {
    "endpoint": { "type": "string", "description": "API endpoint URL" },
    "enabled_feature": { "type": "boolean", "default": false }
  }
}
```

Plato auto-renders a form. Don't ship `slots.adminSettingsPanel` in this case — drop it from `extensionPoints.slots` and from `capabilities`.

### Recipe 6 — emit a custom event

```js
// from anywhere in your plugin's server code
import { emit } from '../../../server/src/lib/plugins/hooks.js';

await emit('my-plugin.invite-sent', { email, inviteId });
```

### Recipe 7 — subscribe to another plugin's event

```js
export default {
  hooks: {},                       // (typed core hooks would go here)
  async onActivate(ctx) {
    // Open-bus subscription:
    const { on } = await import('../../../server/src/lib/plugins/hooks.js');
    on('slack.invite-sent', async (payload) => {
      ctx.logger.info('saw_slack_invite', payload);
    }, { pluginId: 'my-plugin' });
  },
};
```

### Recipe 8 — store and read per-user plugin data

```js
import { getUserMeta, putUserMeta, deleteUserMeta } from '../../../server/src/lib/plugins/sdk.js';

// In a route handler:
await putUserMeta(userId, 'my-plugin', { score: 42, lastSeenAt: new Date().toISOString() });
const meta = await getUserMeta(userId, 'my-plugin');  // -> { score: 42, lastSeenAt: ... } or null
await deleteUserMeta(userId, 'my-plugin');
```

Manifest must declare `user.metadata.read` and/or `user.metadata.write`. Records are stored at `userMeta:<pluginId>` per user — admin-owned by default. Every learner-facing path that touches the user's own data excludes them: `/v1/sync` bulk GET filters them out, single GET/PUT/DELETE reject the key, bulk DELETE preserves them (learner reset doesn't wipe admin-maintained records), and `GET /v1/me/export` filters them. `userMeta:*` is cleaned only via account-deletion (which fires `userDeleted` first) or your plugin's own `onUninstall` hook.

### Recipe 9 — react to user lifecycle events

```js
export default {
  hooks: {
    async userCreated({ userId, email, role }, ctx) {
      ctx.logger.info('saw_new_user', { userId, role });
      // e.g. seed an external system, send a welcome email
    },
    async userDeleted({ userId }, ctx) {
      ctx.logger.info('saw_user_delete', { userId });
      // The user's userMeta:<id> records are auto-deleted by the cascade.
      // Subscribe only if you have side effects beyond plato.
    },
  },
};
```

Manifest must declare `hook.userCreated` / `hook.userDeleted` capabilities. `userCreated` fires after persist; `userDeleted` fires before the cascade (so handlers can read their own per-user data while it still exists).

### Recipe 10 — implement clean-uninstall for plugin data

Plugins that store data (settings, `userMeta:<id>`, `plugin:<id>:*` keys)
should implement `onUninstall` so admins have a clean teardown path.
Without it, the "Delete plugin data" button doesn't appear on the plugin's
card in `/plato/plugins`.

```js
import { db, getUserMeta, deleteUserMeta } from '../../../server/src/lib/plugins/sdk.js';

export default {
  routes,
  async onUninstall(ctx) {
    // Wipe per-user records the plugin owns.
    const users = await db.listAllUsers();
    for (const u of users) {
      if (await getUserMeta(u.userId, ctx.pluginId)) {
        await deleteUserMeta(u.userId, ctx.pluginId);
      }
    }
    // Settings/activation entry is cleared by the host after this returns.
  },
};
```

Errors propagate to the admin — partial cleanup failures are loud, not silent. The host audit-logs `plugin_data_uninstalled` with the admin's user id.

### Recipe 11 — minimal vitest skeleton for a plugin route

```js
// plugins/<id>/server/index.test.js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import plugin from './index.js';

test('GET /admin/things returns array', async () => {
  // The plugin's `routes` is a Hono app — call its fetch directly.
  const res = await plugin.routes.fetch(new Request('http://t/admin/things'));
  // No auth in this minimal test; expect 401 from the authenticate middleware.
  assert.equal(res.status, 401);
});
```

## Schema validation

```bash
node scripts/validate-plugins.js
```

This validates every `plugins/*/plugin.json` against `docs/plugins/plugin.schema.json` AND the host's capability table. Run before committing.

## Where to find things

| Want to know… | File |
|---|---|
| Every slot, hook, capability with full signatures | [EXTENSION_REFERENCE.md](./EXTENSION_REFERENCE.md) |
| What each capability authorizes | [CAPABILITIES.md](./CAPABILITIES.md) |
| Manifest spec (machine-readable) | [plugin.schema.json](./plugin.schema.json) |
| Manifest spec (TypeScript types) | `packages/plugin-sdk/index.d.ts` |
| API stability + deprecation policy | [API_VERSIONING.md](./API_VERSIONING.md) |
| Walked-through examples | [EXAMPLES.md](./EXAMPLES.md) |
| The Slack plugin (real production code) | `plugins/slack/` |

## Per-plugin agent rules

Every plugin scaffold creates a `plugins/<id>/CLAUDE.md`. When working on a specific plugin, read that file first — it captures plugin-specific invariants (e.g., "Slack's bot token is writeOnly — never echo it back").
