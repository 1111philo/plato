<p align="center">
  <img src="client/assets/plato-square.png" alt="plato" width="120" />
</p>

# plato

An Open Source, AI-powered [microlearning](https://philosophers.group/platos-microlearning/) platform. Learners work through focused, exemplar-driven lessons in a continuous conversation with an AI coach that creates activities, evaluates submissions, and tracks progress toward mastery — all in under 20 minutes.

Built by [11:11 Philosopher's Group](https://github.com/1111philo).

Special thanks to [UIC Tech Solutions](https://it.uic.edu/), [UIC TS Open Source Fund](https://osf.it.uic.edu/), [WordPress](https://wordpress.org/), [Louisiana Tech](https://www.latech.edu/), and the [ULL Louisiana Educate Program](https://louisiana.edu/educate).

> **Looking to extend plato?** plato supports plugins like WordPress: add custom user fields, new admin KPIs, AI agents, lifecycle hooks, and more. Run `node scripts/create-plato-plugin.js my-plugin` to scaffold one in seconds, or read the **[plugin authoring guide](docs/plugins/AUTHORING.md)** (and the **[AI-agent guide](docs/plugins/AGENTS.md)** if you're working with Claude Code or similar tools).

## How it works

plato applies [microlearning principles](https://philosophers.group/platos-microlearning/) through AI-powered personalization. Each lesson is a focused experience designed to be completable in ~11 exchanges (~20 minutes), built around a single exemplar and 2-4 learning objectives.

A **lesson** defines an exemplar (the mastery-level outcome a learner produces) and a set of learning objectives. When a learner starts a lesson, an AI coach opens a conversation and guides them through activities — coaching, creating tasks, evaluating submissions (text or images), and tracking progress — all in a single continuous chat. The coach enriches a knowledge base as the learner progresses, adapting to their strengths and weaknesses until they achieve the exemplar.

### Microlearning pacing

Lessons are designed for completion within 11 exchanges (~20 minutes), but the system never cuts a learner off. The coach adapts its approach as exchanges accumulate — and always decides when the exemplar has been demonstrated. There is no hard cutoff and no forced closure.

| Exchanges | Coach behavior |
|-----------|---------------|
| 1-7 | Normal coaching — diagnostics, practice, assessment |
| 8-10 | Approaching target — converge toward the exemplar, prefer focused steps |
| 11+ | Past target — drop non-essential objectives, scaffold to the biggest remaining gap |
| 20+ | Well past target — the lesson probably mismatched the learner; coach flags it in `[KB_UPDATE]` but keeps moving them forward |

The admin dashboard tracks an **On-Target Rate** KPI showing what percentage of lessons complete within the 11-exchange target. A low rate means the **lesson design** or **coach prompt** probably needs tuning — not that pacing should be enforced more aggressively. Extended lessons (2× target or beyond) are surfaced as informational diagnostics, never as metrics to drive to zero.

Admins manage everything from `/plato`: lessons, users, a classroom customizer (styles + knowledge base), and plugins.

## Reporting issues

Issues and feature requests go in [GitHub Issues](https://github.com/1111philo/plato/issues). An automated intake agent reads every new issue and either:

- Tags it `ready-for-pilot` — enough detail is present, a maintainer or the pilot agent will pick it up
- Tags it `needs-info` and posts a few focused clarifying questions — reply inline when you can
- Closes it politely (with an invitation to reopen) if it's spam, off-topic, or abusive

To skip the `needs-info` round-trip, include upfront:

- The URL or page where it happened
- What you did (exact steps)
- What you expected vs. what actually happened
- Any error message, screenshot, or browser console output
- Your browser + OS, and whether you were signed in as a learner or admin

The intake agent only asks for things you can provide. It never asks you to inspect code — that's our job.

## Quick start

### Prerequisites

- Node.js 20+
- npm

### Setup and run

```bash
# Clone the repo
git clone https://github.com/1111philo/plato.git
cd plato

# Install dependencies (client and server)
cd client && npm install && cd ../server && npm install && cd ..

# Build the client (server serves the built files)
cd client && npm run build && cd ..

# Configure your API key
cd server && cp .env.example .env
# Edit .env and add your Anthropic API key

# Start the dev server (uses SQLite — no Docker or AWS needed)
node dev-sqlite.js
```

Open [http://localhost:3000](http://localhost:3000).

On first visit you'll name your classroom and create an admin account. Prompts and lessons are seeded automatically. The knowledge base is created by admins through the conversational KB Editor in the Customizer.

### AI provider

plato needs access to Claude models. Set one of these:

| Option | Env var | Best for |
|--------|---------|----------|
| **Anthropic API** (recommended) | `ANTHROPIC_API_KEY=sk-ant-...` | Local dev, small deployments |
| **Amazon Bedrock** | AWS credentials + `AI_PROVIDER=bedrock` | Production on AWS |

Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com/settings/keys). If `ANTHROPIC_API_KEY` is set, plato uses it automatically. For Bedrock, set `AI_PROVIDER=bedrock` and configure AWS credentials.

Then log in and navigate to `/plato` to see the admin dashboard, or `/lessons` to start learning.

## Project layout

```
plato/
  client/                React 19 + Vite SPA (learner and admin UI)
  server/                Node.js + Hono + AWS Lambda + DynamoDB (API, auth, data, AI proxy)
  plugins/               Built-in and community plugins (e.g. plugins/slack)
  packages/plugin-sdk/   TypeScript types for plugin authors
  docs/plugins/          Plugin authoring docs (start at AUTHORING.md or AGENTS.md)
  scripts/               Build, deploy, and plugin scaffolding tooling
  docs/                  Extended guides (deployment, etc.)
```

For architectural details (AI agents, data model, auth, conventions) see [CLAUDE.md](CLAUDE.md).

## Extending plato

There are two contribution paths and they have different review bars:

**Build a plugin (most common).** Plugins live in `plugins/<id>/` and have a lighter review bar — they sit alongside core, declare what they touch via capabilities, and can't override completion semantics or other core invariants. Scaffold a working plugin with:

```bash
node scripts/create-plato-plugin.js my-plugin --name "My Plugin"
```

Then read [docs/plugins/AUTHORING.md](docs/plugins/AUTHORING.md) (humans) or [docs/plugins/AGENTS.md](docs/plugins/AGENTS.md) (AI agents). The full extension reference is at [docs/plugins/EXTENSION_REFERENCE.md](docs/plugins/EXTENSION_REFERENCE.md). Plugins can add admin pages, custom settings UI, server routes, lifecycle hooks, and more.

**Contribute to plato core.** Anything outside `plugins/` is core — coach, lessons, KPIs, agents, the plugin host itself. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review process; [CLAUDE.md](CLAUDE.md) for architecture context. Core changes require more review than plugin changes because they affect every plato deployment, including the public plugin contract.

## Deployment

For production deployment to AWS — SAM setup, CI/CD from a private fork, custom domains, backups — see **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Accessibility

plato is designed to be fully usable with screen readers (VoiceOver, NVDA, JAWS) and keyboard-only navigation. The AI chat follows the [MITRE Chatbot Accessibility Playbook](https://mitre.github.io/chatbot-accessibility-playbook/) and [Orange accessibility guidelines](https://a11y-guidelines.orange.com/en/articles/chatbot/): silent-by-default chat log, controlled announcements for new messages, keyboard navigation between messages (`Alt+ArrowUp`/`Alt+ArrowDown`), and `Cmd/Ctrl+Enter` to send. Implementation details live in [CLAUDE.md](CLAUDE.md).

## Contributing

Plugins live in `plugins/` and have a lighter review bar — see [docs/plugins/AUTHORING.md](docs/plugins/AUTHORING.md). Core changes (anything outside `plugins/`) follow [CONTRIBUTING.md](CONTRIBUTING.md). The `main` branch is protected — all changes require a pull request.

## License

Copyright (C) 2026 [11:11 Philosopher's Group](https://github.com/1111philo)

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License v3.0](LICENSE) as published by the Free Software Foundation. Modified versions that are accessible over a network must also be made available under the same license.
