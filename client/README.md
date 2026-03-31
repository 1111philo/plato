<p align="center">
  <img src="assets/logo.svg" alt="1111" width="80" height="80">
</p>

# 1111 Learn

An agentic learning app at [learn.philosophers.group](https://learn.philosophers.group). Seven AI agents drive an exemplar-driven learning loop -- a Coach converses with the learner, coaching and assessing inline while enriching a growing knowledge base until the learner achieves the course exemplar.

Built by [11:11 Philosopher's Group](https://github.com/1111philo) in collaboration with [UIC Tech Solutions](https://it.uic.edu/), [UIC TS Open Source Fund](https://osf.it.uic.edu/), [Louisiana Tech](https://www.latech.edu/), and the [ULL Louisiana Educate Program](https://louisiana.edu/educate).

## How it works

1. **Start a course** -- the Course Owner builds a knowledge base from the course exemplar and your profile
2. **Learn with the Coach** -- the Coach converses with you, creating activities tuned to where you are and assessing your submissions inline
3. **Knowledge base grows** -- every Coach response enriches the KB with new insights about your strengths and gaps
4. **Repeat** -- each coaching turn is more precisely tuned as the KB grows
5. **Achieve the exemplar** -- when your work demonstrates mastery, the course is complete

Everything happens in the browser. Images and text responses are assessed by the Coach and stored locally. No data leaves your device unless you opt into cloud sync.

## Quick start

```bash
git clone https://github.com/1111philo/learn.git
cd learn
npm install
npm run build
```

Then serve `dist/` with any static server (e.g., `npx serve dist`) and open it in your browser. Or just visit [learn.philosophers.group](https://learn.philosophers.group).

You'll need an [Anthropic API key](https://console.anthropic.com/) or a 1111 Learn account.

## Documentation

| Doc | What's in it |
|-----|-------------|
| [Architecture](docs/architecture.md) | Agents, knowledge bases, storage, content hierarchy, data flow |
| [Agent Lifecycle](docs/agent-lifecycle.md) | Full walkthrough of the exemplar-driven learning loop: every agent call, its inputs, outputs, and validation |
| [Cloud Sync](docs/cloud-sync.md) | Auth, remote storage, AI provider routing |
| [Releases](docs/releases.md) | CI/CD, versioning, branch protection, permissions, secrets |
| [Contributing](CONTRIBUTING.md) | Dev setup, workflow, guidelines, how to submit changes |
| [Privacy Policy](PRIVACY.md) | What's stored, what's synced, your rights |

## Project structure

```
js/          Service modules (vanilla JS) -- storage, orchestration, auth, sync
src/         React 18 app -- pages, components, contexts, hooks
prompts/     Agent system prompts (markdown) -- edit these to change agent behavior
data/        Course prompts (markdown files in data/courses/)
tests/       Node built-in test runner -- courses, validators, storage, platform
dist/        Build output (deployed to GitHub Pages)
```

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

Key things to know:
- Branch from `staging`, PR into `staging`. Production releases flow from `staging` to `main`.
- Agent prompts are in `prompts/*.md` -- you can change agent behavior without touching code.
- Course definitions are in `data/courses/*.md` -- add a markdown file to add a course.
- Run `npm test` before submitting. All tests must pass.
- Accessibility is non-negotiable.

## License

Copyright (C) 2026 11:11 Philosopher's Group

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
