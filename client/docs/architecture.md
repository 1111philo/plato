# Architecture

1111 Learn is a web app deployed to `learn.philosophers.group` via GitHub Pages. The UI is a React 18 app built with Vite. Service modules are vanilla JS (ES modules) in `js/`, imported by React components in `src/`. All data is stored client-side in SQLite (via sql.js WASM) persisted to IndexedDB.

## Agents

Seven agents drive the learning experience. Each agent loads a system prompt from `prompts/*.md`.

| Agent | Prompt | Model | Purpose |
|-------|--------|-------|---------|
| Coach | [`coach.md`](../prompts/coach.md) | Light | The learner's companion, teacher, and assessor in one conversation; coaches toward the exemplar, evaluates responses, tracks progress via `[PROGRESS: 0-10]`, updates KB via `[KB_UPDATE]`, updates profile via `[PROFILE_UPDATE]` |
| Course Owner | [`course-owner.md`](../prompts/course-owner.md) | Light | Initializes the course KB from course prompt + learner profile; produces structured objectives, evidence descriptors, initial learner position |
| Course Creator | [`course-creator.md`](../prompts/course-creator.md) | Light | Coaches users through designing custom courses; guides exemplar and objective definition; emits `[READINESS: 0-10]` signal |
| Course Extractor | [`course-extractor.md`](../prompts/course-extractor.md) | Light | Extracts course markdown from a creation conversation |
| Learner Profile Owner | [`learner-profile-owner.md`](../prompts/learner-profile-owner.md) | Light | Deep profile update on course completion |
| Learner Profile Update | [`learner-profile-update.md`](../prompts/learner-profile-update.md) | Light | Profile update from feedback/observations |

`MODEL_LIGHT` = `claude-haiku-4-5`. `MODEL_HEAVY` = `claude-sonnet-4-6`. See [`js/api.js`](../js/api.js) for model constants.

For the full invocation sequence with inputs and outputs, see [Agent Lifecycle](agent-lifecycle.md).

## Orchestration

[`js/orchestrator.js`](../js/orchestrator.js) is the central layer between agents and the app:

- **`converseStream(promptName, messages, onChunk)`** -- streaming conversations (coach). Yields text tokens via callback as they arrive. Falls back to non-streaming if no local API key.
- **`initializeCourseKB(course, profileSummary)`** -- Course Owner: generates the initial course KB.
- **`updateProfileOnCompletion(...)`** -- Learner Profile Owner: deep profile update on course mastery.
- **`updateProfileFromFeedback(...)`** -- Learner Profile Update: profile update from user feedback in Settings.
- **Routing** -- if logged in, calls go to the learn-service Bedrock proxy; otherwise, they use the user's Anthropic API key directly.
- **Retry** -- validation failures retry once automatically. Transient API errors (503, 529, 500) retry up to twice with backoff (3s, 6s).

[`src/lib/courseEngine.js`](../src/lib/courseEngine.js) is the state machine that sits above the orchestrator. It manages the exemplar-driven learning loop: course start, the Coach conversation (coaching + assessment in every response), KB enrichment, and completion detection. `CourseChat.jsx` calls courseEngine functions in response to user actions.

[`js/courseOwner.js`](../js/courseOwner.js) loads course prompt files from `data/courses/*.md`, parses them into structured data (`{ courseId, name, description, exemplar, learningObjectives }`), and provides `updateCourseKBFromAssessment()` to merge assessment insights into the course KB.

A program knowledge base ([`data/knowledge-base.md`](../data/knowledge-base.md)) is automatically loaded and appended to the system prompt for the Coach. This gives it context about the AI Leaders program so it can answer program-related questions. The KB is cached after first load.

## Knowledge bases

Three knowledge bases drive personalization throughout the learning experience:

### Course KB (`course_kbs` table)
Initialized by the Course Owner from the course prompt + learner profile. Contains:
- `exemplar` -- the mastery-level outcome description
- `objectives[]` -- each with `objective` and `evidence` (what demonstrates it)
- `learnerPosition` -- where the learner currently stands (updated after each assessment)
- `insights[]` -- accumulated observations about the learner's work (grows with each assessment)
- `activitiesCompleted` -- count of activities completed
- `status` -- `"active"` or `"completed"`

After every Coach response containing a `[KB_UPDATE]`, the update is merged in via `updateCourseKBFromAssessment()`: new insights are appended, learner position is replaced, and activity count is incremented.

### Activity KB (`activity_kbs` table)
Per-activity record containing:
- `instruction`, `tips` -- the generated activity
- `attempts[]` -- each attempt's assessment results (achieved, demonstrates, strengths, moved, needed)

Used as context when generating subsequent activities.

### Learner Profile (`profile` + `profile_summary` tables)
Persistent across courses:
- `name`, `goal`
- `masteredCourses[]`, `activeCourses[]`
- `strengths[]`, `weaknesses[]`
- `preferences{}`
- Updated via `[PROFILE_UPDATE]` signals from the Coach
- Updated deeply by Learner Profile Owner LLM on course completion

## Output validation

All agent outputs pass through deterministic validators in [`js/validators.js`](../js/validators.js) before reaching the user:

| Validator | Checks |
|-----------|--------|
| `validateActivity` | Instruction present, tips array, ends with "Upload" or "Submit", max 5 steps (4 + final), browser-only, no platform shortcuts, no multi-site, no DevTools, produces visible work, content safety |
| `validateCourseKB` | Exemplar, objectives array (each with objective + evidence), learnerPosition, insights array, activitiesCompleted number, status, content safety |

## Content hierarchy

```
Course prompt (data/courses/*.md)
  ├── Exemplar (mastery-level outcome description)
  ├── Learning Objectives (bullet list)
  └── Course KB (generated by Course Owner, enriched by Coach via [KB_UPDATE])
        └── Activities (created inline by Coach during conversation)
              └── Drafts (uploaded images or text responses assessed by Coach)
```

Courses are defined as markdown files in `data/courses/`. Each file has:
- `# Title` -- course name
- First paragraph -- course description
- `## Exemplar` -- what mastery looks like
- `## Learning Objectives` -- bullet list of outcomes

[`js/courseOwner.js`](../js/courseOwner.js) parses these files via `loadCourses()`. Adding a new course means creating a `.md` file in `data/courses/` and adding its ID to the `courseFiles` array in `courseOwner.js`.

There are no predefined units, rubrics, journeys, or summative assessments. Activities are generated dynamically based on the evolving course KB.

## Storage

### SQLite (structured data)

All structured data lives in an in-memory SQLite database powered by [sql.js](https://github.com/sql-js/sql.js) (WASM). The database is serialized and persisted to IndexedDB via `kvStorage` from [`js/platform.js`](../js/platform.js) under key `_sqliteDb` (debounced, plus on `visibilitychange`).

- [`js/platform.js`](../js/platform.js) -- asset URL resolution, IndexedDB key-value storage
- [`js/db.js`](../js/db.js) -- database lifecycle: init, schema creation, persistence, column migrations
- [`js/storage.js`](../js/storage.js) -- query API: getters/setters for all data types

Tables: `settings`, `preferences`, `profile`, `profile_summary`, `course_kbs`, `activity_kbs`, `activities`, `drafts`, `auth`, `pending_state`, `course_messages`.

The `course_messages` table stores the unified conversation per course (role, content, msg_type, phase, metadata JSON, timestamp). Activity IDs follow the pattern `{courseId}-act-{number}`. Drafts store assessment results inline (`achieved`, `demonstrates`, `moved`, `needed`, `strengths`).

### IndexedDB (binary assets)

Uploaded images are stored in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` table. Text responses are stored directly in the SQLite `text_response` column.

## Data flow

```
Course Prompt (.md) ─── Course Owner ─── Course KB (initialized)
                                              │
                              Coach ←─────────┤ (reads enriched KB)
                                │             │
                          Coaches, creates    │
                          activities, and     │
                          assesses inline     │
                                │             │
                          [KB_UPDATE] ────────┤ (writes insights back)
                          [PROFILE_UPDATE]    │
                          [PROGRESS: 0-10]    │
                                │             │
                   ┌────────────┴──────┐      │
                   │                   │      │
              not achieved       achieved
                   │                   │
              Conversation       Coach celebrates
              continues          Profile deep update (LLM)
              (enriched KB)      Course complete

Learner Profile ──── threads through every agent call as context
```

- The **course KB** is the central data structure: initialized once, then enriched after every Coach response via `[KB_UPDATE]` with new insights and updated learner position.
- The **Coach** reads the enriched KB, so each coaching response and activity is more precisely tuned to the learner.
- The **Coach** writes back to the KB via `[KB_UPDATE]`, closing the learning loop.
- The **learner profile** is passed as context to every agent call but updated separately (via `[PROFILE_UPDATE]` from the Coach, and deeply by Learner Profile Owner LLM on completion).

## File structure

```
sidepanel.html           Vite entry point
sidepanel.css            Global styles
vite.config.js           Vite build config
CNAME                    GitHub Pages custom domain
lib/                     Vendored sql.js (WASM)
js/                      Service modules (vanilla JS)
  platform.js            Asset URL resolution + IndexedDB kvStorage
  db.js                  SQLite lifecycle
  storage.js             Query layer + IndexedDB for images
  courseOwner.js          Course prompt loading + KB updates
  api.js                 Anthropic API client
  orchestrator.js        Agent orchestration
  validators.js          Output validators
  auth.js                Auth for learn-service
  sync.js                Cloud data sync
src/                     React app
  main.jsx               Entry: db init, React mount
  App.jsx                Routes
  contexts/              AppContext, AuthContext, ModalContext
  hooks/                 useViewTransition, useAutoResize
  lib/                   courseEngine, courseCreationEngine, profileQueue, syncDebounce, helpers, constants
  components/            AppShell, chat/*, modals/*
  pages/                 CoursesList, CourseChat, CourseCreate, Settings, onboarding/*
prompts/                 Agent system prompts (markdown)
data/courses/            Course prompt files (markdown)
data/knowledge-base.md   Program knowledge base
tests/                   Node test runner (courses, validators, storage, platform)
docs/                    Documentation
dist/                    Build output (deployed to GitHub Pages)
```
