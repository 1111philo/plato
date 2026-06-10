# plugins/wordpress-info/ — Claude / agent instructions

Multi-agent WordPress lesson enrichment plugin. Automatically detects WordPress-
related lessons at start time and enriches them with up-to-date context from:
1. wordpress.org developer docs (REST API /wp/v2/search)
2. Make WordPress blogs (REST API /wp/v2/posts)  
3. GitHub WordPress/WordPress core repo (GitHub API code search)

## Architecture

Three-agent pipeline triggered by the `lessonStarted` hook:

1. **Planner agent** (`prompts/wordpress-info-planner.md`) — takes the lesson
   exemplar + objectives and decides:
   - Is this WordPress-related? (keyword detection)
   - What queries to run?
   - Which sources to check per query?
   Returns structured JSON: `{ shouldEnrich: bool, queries: [{ text, sources }] }`.

2. **Query executor** (`server/query-executor.js`) — runs each query against
   the selected sources in parallel. Queries wordpress.org, Make blogs, and
   GitHub. Returns `[{ url, title, excerpt }]` per query. Fail-open — timeouts
   or API errors never block.

3. **Synthesizer agent** (`prompts/wordpress-info-synthesizer.md`) — takes the
   raw results and lesson context, synthesizes a concise (~300 word) summary
   highlighting: relevant APIs, best practices, common pitfalls, version-specific
   notes. Returns `{ context: string, reasoning: string }`.

The final enrichment data (`{ context, sources, reasoning, pluginId, label }`)
is returned from the `lessonStarted` hook handler, stored on `lessonKB.enrichments`,
and injected into the coach's system context. The learner sees it in the "Additional
Context" section of the lesson overview dialog (alongside exemplar and objectives),
accessible throughout the lesson.

## Local invariants

- **Fail open, always.** A non-WordPress lesson, planner error, executor timeout,
  or synthesizer failure returns `null` (no enrichment) — the lesson starts
  normally. Enrichment errors must never block lesson start.
- **No settings.** Keywords, sources, and API endpoints are hardcoded best-practice
  defaults in the plugin. No admin configuration UI.
- **SSRF defense is the executor's job.** All URLs come from author-controlled
  constants or are fetched from allowlisted APIs; user input (the lesson text)
  never constructs a URL host.
- **Untrusted content.** The enrichment context is reference material only. It
  provides background the coach can draw on but MUST NOT override completion
  semantics — `applyCoachResponseToKB` remains the single owner of progress.
- **Timing.** The hook fires after the Lesson Owner agent initializes the KB but
  before the Coach opens the conversation. The enrichment is computed once at
  start and cached on the lessonKB — it never re-runs on resume.

## Files

- `server/index.js` — hook handler, orchestrates the 3-agent pipeline
- `server/query-executor.js` — fetches from wordpress.org, Make, GitHub
- `server/sources.js` — SOURCES list (API endpoints) and KEYWORDS (WordPress, WP,
  Gutenberg, etc.)
- `prompts/wordpress-info-planner.md` — planner agent prompt (via orchestrator)
- `prompts/wordpress-info-synthesizer.md` — synthesizer agent prompt

## When changing this plugin

- Add a source: update `SOURCES` in `sources.js` with `{ id, label, kind, base }`.
  `kind` is `'wporg-docs'`, `'make-blogs'`, or `'github-code'`. The executor
  knows how to query each kind.
- Add a keyword: update `KEYWORDS` in `sources.js`. The planner uses these to
  decide whether to enrich.
- Mind the fan-out: every query runs against N sources in parallel. Keep query
  count (planner output) and source count reasonable to avoid overwhelming the
  APIs or ballooning latency.
- Test locally: `node dev-sqlite.js`, enable the plugin at `/plato/plugins`, then
  start a lesson with "WordPress" in the objectives. Check the enrichment loading
  step in the startup UI, then click "Lesson Overview" to see the context and sources.

## Anti-goals

- Don't make the plugin configurable (keyword lists, source toggles, etc.) unless
  a real user asks for it. Config adds complexity; curated defaults are simpler.
- Don't inline the full documentation text into the coach context — the synthesizer
  distills it. Coach context must stay compact.
- Don't let enrichment delay the lesson start beyond ~3-5 seconds. If latency
  becomes a problem, reduce query count or cache common lookups.
