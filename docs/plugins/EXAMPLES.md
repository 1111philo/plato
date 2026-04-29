# Examples

Three walkthroughs at increasing complexity.

## hello-world (smallest possible)

Demonstrates: manifest, settings schema, auto-rendered settings form.

Generate it:

```bash
node scripts/create-plato-plugin.js hello-world --name "Hello World"
```

This creates:

```
plugins/hello-world/
  plugin.json
  server/index.js              # one route, lifecycle hooks
  client/SettingsPanel.jsx     # one boolean checkbox
  client/index.js
  CLAUDE.md
```

The default scaffold ships with a custom `SettingsPanel.jsx`. To use the auto-rendered form instead, delete `client/` entirely and remove the `slots` entry + the `ui.slot.adminSettingsPanel` capability from the manifest. Plato will render a form from `settingsSchema`.

## slack (real production code)

Located at `plugins/slack/`. Demonstrates:

- Server router with auth + admin middleware
- Lifecycle migration (legacy `_system:settings.slack` → plugin's settings record)
- Custom `adminSettingsPanel` slot with multi-step UX (test → connect → disconnect)
- writeOnly settings (the bot token is stripped from `GET /v1/plugins`)
- Built-in flag (`builtIn: true`) — can be disabled but not uninstalled

Read `plugins/slack/server/index.js` and `plugins/slack/client/SlackSettingsPanel.jsx` for the full implementation.

Key patterns to copy:

- **SDK imports**: `import { Hono, db, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js'`
- **Settings access**: `ctx.settings` in lifecycle, or read from `_system:plugins:activation` for arbitrary lookups
- **Plugin-scoped logs**: `ctx.logger.info('event_name', { ...meta })`
- **Migration on activate**: use `ctx.setSettings()` to persist new settings, idempotently

## teacher-comments (Phase-2 forward-looking, code-stub only)

> **This plugin is not implemented in Phase 1.** It demonstrates extension points planned for Phase 2 and serves as a target for the user-metadata + KPI work.

Goal: add a "Teacher comments" textarea on the admin user detail page; track average comment length as a KPI.

Forward-looking shape:

```
plugins/teacher-comments/
  plugin.json
  server/index.js              # subscribes to userCreated; exposes a /admin/comments endpoint
  client/CommentsField.jsx     # adminProfileFields slot
  client/CommentsKpi.jsx       # adminHomeKpi slot
```

`plugin.json`:

```json
{
  "$schema": "../../docs/plugins/plugin.schema.json",
  "id": "teacher-comments",
  "name": "Teacher Comments",
  "version": "0.1.0",
  "apiVersion": "2.x",
  "description": "Per-user teacher comments + average-length KPI.",
  "capabilities": [
    "server.routes",
    "settings.read",
    "settings.write",
    "user.metadata.read",
    "user.metadata.write",
    "ui.slot.adminProfileFields",
    "ui.slot.adminHomeKpi",
    "kpi",
    "hook.userCreated"
  ],
  "extensionPoints": {
    "serverRoutes": "server/index.js#default",
    "slots": {
      "adminProfileFields": "client/CommentsField.jsx",
      "adminHomeKpi": "client/CommentsKpi.jsx"
    },
    "hooks": ["userCreated"]
  }
}
```

`server/index.js`:

```js
import { Hono, db, authenticate, requireAdmin } from '../../../server/src/lib/plugins/sdk.js';

const routes = new Hono();
routes.use('*', authenticate, requireAdmin);

routes.put('/admin/comment/:userId', async (c) => {
  const { userId } = c.req.param();
  const { text } = await c.req.json();
  await db.putUserMeta(userId, 'teacher-comments', { text, updatedAt: new Date().toISOString() });
  return c.json({ ok: true });
});

export default {
  routes,
  hooks: {
    async userCreated({ userId }, ctx) {
      ctx.logger.info('seeded_metadata', { userId });
      await ctx.db.putUserMeta(userId, 'teacher-comments', { text: '', updatedAt: null });
    },
  },
  kpis: [{
    id: 'avg-comment-length',
    label: 'Avg. teacher comment length',
    async compute({ db }) {
      const users = await db.listAllUsers();
      let total = 0, count = 0;
      for (const u of users) {
        const meta = await db.getUserMeta(u.userId, 'teacher-comments');
        if (meta?.text) { total += meta.text.length; count++; }
      }
      return count === 0 ? 0 : Math.round(total / count);
    },
  }],
};
```

The Phase 2 SDK will add `db.putUserMeta` / `db.getUserMeta` and the `userCreated` emit-point to make this real. Until then, treat this example as a design target.

## Best-practice patterns extracted from the examples

| Pattern | Where used |
|---|---|
| Single-source SDK imports for the host | All examples |
| `writeOnly: true` for secrets | Slack |
| Idempotent `onActivate` | Slack (legacy migration) |
| Plugin-scoped logger via `ctx.logger` | All examples |
| Per-plugin `CLAUDE.md` capturing local invariants | Slack, scaffolder |
| `defaultEnabled: false` for non-core plugins | hello-world (scaffolder) |
| `defaultEnabled: true, builtIn: true` for core plugins | Slack |
| Auto-rendered form when no custom panel needed | hello-world (alternate path) |
