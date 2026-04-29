# plato plugins

plato is extensible like WordPress, but with a modern JS host and a TypeScript types-only SDK. Plugins live in `plugins/<id>/` and ship in the same SAM build as the host. No runtime code uploads — all plugin code is committed to a git repo.

## Quickstart

```bash
node scripts/create-plato-plugin.js my-plugin --name "My Plugin"
node scripts/validate-plugins.js
node server/dev-sqlite.js
```

Open `/plato/plugins` and toggle the plugin on.

## What plugins can do (Phase 1)

- Add HTTP routes under `/v1/plugins/<id>/`
- Render React components inside named UI slots (e.g. `adminSettingsPanel`)
- Store and read plugin-scoped settings (with admin UI auto-rendered from JSON Schema)
- Run lifecycle methods (`onActivate`, `onDeactivate`)
- Emit and subscribe to events on the open hook bus
- Contribute AI prompts (Phase 3)

What plugins can NOT do (Phase 1):
- Override completion semantics (`applyCoachResponseToKB` is the single owner)
- Introduce hard exchange-count cutoffs
- Write to other plugins' settings, or to `_system:settings.*` directly
- Touch core files outside `plugins/<id>/` without going through the core-PR path

## Documentation map

| For… | Read |
|---|---|
| **AI agents** building a plugin | [AGENTS.md](./AGENTS.md) — decision tree, DO-NOT list, copy-paste recipes |
| Humans building a plugin | [AUTHORING.md](./AUTHORING.md) |
| Looking up a slot/hook/capability | [EXTENSION_REFERENCE.md](./EXTENSION_REFERENCE.md) |
| Understanding the security model | [CAPABILITIES.md](./CAPABILITIES.md) |
| API stability + deprecation | [API_VERSIONING.md](./API_VERSIONING.md) |
| Working examples | [EXAMPLES.md](./EXAMPLES.md) |
| Validating a manifest | [plugin.schema.json](./plugin.schema.json) |

## Distribution

For Phase 1, plugins are distributed by committing them to your fork of plato. There is no upload UI and no marketplace. The admin UI at `/plato/plugins` lets admins enable/disable and configure pre-installed plugins. Phase 2 may add a sandboxed-worker model for runtime-installed plugins.

If you build a plugin you'd like upstream, open a PR to `1111philo/plato` adding `plugins/<your-id>/`. Plugins live alongside core but have a lighter review bar than core changes — the only review questions are: "does it validate? does it follow the do-not list? does it have its own tests?".
