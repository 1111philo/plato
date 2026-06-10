# plugins/hello-world-context/ — Claude / agent instructions

Minimal example plugin demonstrating the lessonEnrichment pattern.

## What it does

Adds "Hello World" context to EVERY lesson (no keyword detection). Shows that:
- Any plugin with `lessonEnrichment` capability can add context
- Multiple plugins can enrich the same lesson (WordPress Info + Hello World)
- Enrichments appear in the "Additional Context" section of lesson overview
- Context is injected into coach system prompt automatically

## Architecture

Single hook handler that returns enrichment data:
```js
{
  pluginId: 'hello-world-context',
  label: 'Hello World Plugin',
  context: 'Reference material text...',
  reasoning: 'Why this context matters',
  sources: [{ url, title, excerpt }]
}
```

No AI agents, no external APIs — just demonstrates the contract.

## When to use this pattern

- Internal knowledge bases (query company wiki for lesson topic)
- Recent updates (pull latest release notes, deprecations)
- Security policies (inject org-specific code standards)
- Custom integrations (Notion, Confluence, internal docs)

## Files

- `plugin.json` — declares `lessonEnrichment` + `hook.lessonStarted`
- `server/index.js` — hook handler returns enrichment data

## Testing

1. Enable plugin at `/plato/plugins`
2. Start ANY lesson
3. Click "Lesson Overview"
4. See "Additional Context" section with Hello World enrichment
5. If WordPress Info is also enabled, both enrichments appear
