# Contributing to 1111 Learn

Thank you for your interest in contributing. This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo) in collaboration with [UIC Tech Solutions](https://it.uic.edu/), [UIC TS Open Source Fund](https://osf.it.uic.edu/), [Louisiana Tech](https://www.latech.edu/), and the [ULL Louisiana Educate Program](https://louisiana.edu/educate).

## Getting started

1. Fork and clone the repository.
2. Run `npm install` to install dependencies.
3. Copy `.env.example.js` to `.env.js` and fill in your Anthropic API key and name. This file is gitignored. On app load, these values seed storage automatically.
4. Run `npm run dev` to start the Vite dev server, or `npm run build` to build into `dist/`.
5. Open the dev server URL in your browser. The onboarding wizard runs on first use.

To reset and re-run onboarding, clear site data in your browser's DevTools.

## Development workflow

- Run `npm run dev` for the Vite dev server, or `npm run build` for production builds.
- React components live in `src/`. Service modules (storage, orchestrator, auth, sync, courseOwner, platform) live in `js/`.
- Agent system prompts live in `prompts/*.md` -- edit these to change agent behavior without touching code.
- Course definitions live in `data/courses/*.md` -- each is a markdown file with exemplar + learning objectives.
- Use browser DevTools to inspect state and debug.

For architecture details, see [docs/architecture.md](docs/architecture.md). For the full agent invocation flow, see [docs/agent-lifecycle.md](docs/agent-lifecycle.md).

## Activity constraints

Activities must:
- Be completable entirely in the browser
- Lead to one visible result on one page, fitting in a single viewport
- End with "Upload an image of your work." or "Hit Submit to submit your response."
- Not reference desktop apps, terminals, or file system operations
- Not use platform-specific keyboard shortcuts
- Not use DevTools or browser developer tools
- Take 5 minutes or less
- Produce visible work (writing, creating, building, etc.)

## Adding a new course

1. Create a markdown file in `data/courses/` (e.g., `my-course.md`)
2. Follow the format: `# Title`, description paragraph, `## Exemplar`, `## Learning Objectives` with bullet list
3. The build-time manifest plugin auto-discovers all `.md` files in `data/courses/`
4. Test with a real API key to verify the Course Owner generates a valid KB

## Guidelines

- **Accessibility is required.** Every interactive element must be keyboard-operable and have an accessible name.
- **Keep it lightweight.** No heavy frameworks or dependencies.
- **Local-first.** No telemetry. All data stays in the browser unless the user logs in to sync.
- **Update documentation.** If your change adds, removes, or renames a feature, file, or permission, update the relevant docs.
- **Test prompts.** When editing `prompts/*.md`, test with a real API key to verify the agent returns valid JSON.

## Running tests

```bash
npm test
```

Tests use Node's built-in test runner (no extra dependencies). They validate course prompts, SQLite storage round-trips, platform utilities, and output validators. All tests must pass before merging.

## Schema changes

Data is stored in SQLite via sql.js (WASM). When adding or modifying tables/columns:

1. Update the `CREATE TABLE` DDL in [`js/db.js`](js/db.js)
2. Add an `ALTER TABLE` migration to the `MIGRATIONS` array (for existing databases)
3. Update getter/setter functions in [`js/storage.js`](js/storage.js)
4. Add round-trip tests in [`tests/storage.test.js`](tests/storage.test.js)

## Submitting changes

1. Create a branch from `staging`.
2. Make focused, well-described commits.
3. Run `npm test` -- all tests must pass.
4. Open a pull request **into `staging`** with a clear summary.
5. Once merged, a release candidate (RC) tag is automatically created.

**`main` is protected** -- all changes flow through `staging` via pull request. See [docs/releases.md](docs/releases.md) for the full versioning and release process.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
