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
- `defaultEnabled: true` — Slack ships in this repo and is on by default for new installs

Read `plugins/slack/server/index.js` and `plugins/slack/client/SlackSettingsPanel.jsx` for the full implementation.

Key patterns to copy:

- **SDK imports**: `import { Hono, db, authenticate, requireAdmin } from '../../../src/lib/plugins/sdk.js'`
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
import { Hono, db, authenticate, requireAdmin } from '../../../src/lib/plugins/sdk.js';

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
| `defaultEnabled: true` for plugins this repo ships on by default | Slack |
| Auto-rendered form when no custom panel needed | hello-world (alternate path) |

## wordpress-info (lesson enrichment reference implementation)

Located at `plugins/wordpress-info/`. Demonstrates:

- **Lesson enrichment pattern** — `lessonStarted` hook + `lessonEnrichment` capability
- **Multi-agent pipeline** — planner → query executor → synthesizer
- **External API integration** — wordpress.org REST API, Make WordPress blogs, GitHub code search
- **SSRF defense** — all fetched URLs validated against `ALLOWED_HOSTS`
- **Fail-open architecture** — errors never block lesson start
- **Structured agent output** — JSON schema validation for planner/synthesizer responses
- **No settings UI** — keywords and sources are hardcoded best-practice defaults

### Architecture

**Three-agent pipeline:**

1. **Planner** (`prompts/wordpress-info-planner.md`)
   - Input: lesson exemplar + objectives + keyword list
   - Output: `{ shouldEnrich: bool, queries: [{ text, sources }] }`
   - Decides if lesson is WordPress-related and what to query

2. **Query executor** (`server/query-executor.js`)
   - Input: queries from planner
   - Fetches from wordpress.org docs, Make blogs, GitHub (parallel)
   - Output: `[{ query, results: [{ url, title, excerpt }] }]`
   - Timeouts and errors return empty results (fail-open)

3. **Synthesizer** (`prompts/wordpress-info-synthesizer.md`)
   - Input: lesson context + query results
   - Output: `{ context: string (~300 words), reasoning: string }`
   - Distills results into lesson-specific summary

**Hook handler** (`server/index.js`)
- Orchestrates the 3-agent pipeline
- Returns enrichment object or `null`
- Host stores on `lessonKB.enrichments`, injects into coach context
- Learner sees artifact panel above first coach message

### Key patterns to copy

```js
// Hook handler with enrichment return value
export default {
  hooks: {
    lessonStarted: async ({ userId, lessonId, lesson, lessonKB }) => {
      try {
        // Decide whether to enrich
        const plan = await callPlannerAgent(lesson);
        if (!plan.shouldEnrich) return null;

        // Fetch external docs
        const results = await queryExternalAPIs(plan.queries);
        if (!results.length) return null;

        // Synthesize lesson-specific context
        const synthesis = await callSynthesizerAgent(lesson, results);

        // Return enrichment data
        return {
          pluginId: 'my-plugin',
          label: 'External Docs',
          context: synthesis.context,
          reasoning: synthesis.reasoning,
          sources: results.map(r => ({ url: r.url, title: r.title })),
        };
      } catch (err) {
        // Fail open — log and return null
        console.error('[my-plugin] Enrichment failed:', err);
        return null;
      }
    },
  },
};
```

### Testing

`plugins/wordpress-info/server/query-executor.test.js` demonstrates:
- SSRF defense validation (every source URL → ALLOWED_HOSTS)
- Source schema validation
- Keyword consistency checks

### Files

```
plugins/wordpress-info/
  plugin.json                    # Manifest: lessonEnrichment + agent capabilities
  server/index.js                # Hook handler (3-agent orchestrator)
  server/sources.js              # KEYWORDS, SOURCES, ALLOWED_HOSTS
  server/query-executor.js       # Parallel API fetching with timeout
  server/query-executor.test.js  # SSRF + schema validation tests
  prompts/wordpress-info-planner.md      # Agent 1: detect + plan queries
  prompts/wordpress-info-synthesizer.md  # Agent 3: distill into summary
  CLAUDE.md                      # Architecture, invariants, anti-goals
```

### Gotchas

- **Agent prompts** — Phase 1 loads via `fs.readFile`; Phase 3's `agent` capability will formalize prompt upsertion to sync-data
- **Structured output** — Agents are instructed to return JSON; parsing happens in the hook handler (no native structured-output tool yet)
- **Timing** — Enrichment runs after Lesson Owner KB init but before Coach starts; total lesson-start latency must stay reasonable (~3-5s)
- **Resume** — Enrichment is cached on `lessonKB.enrichments`; never re-runs on resume (learner sees same artifacts every time)

See `plugins/wordpress-info/CLAUDE.md` for the full deep-dive.
