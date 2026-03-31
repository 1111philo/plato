# CLAUDE.md -- 1111 Learn

## Project overview
1111 Learn is a web app deployed to `learn.philosophers.group` via GitHub Pages. Seven AI agents drive an exemplar-driven learning loop powered by the Claude API. A course defines an exemplar (the mastery-level outcome) and learning objectives; the Coach converses with the learner -- coaching, creating activities, and assessing submissions inline -- while enriching a growing knowledge base, repeating until the learner achieves the exemplar. The user provides their own Anthropic API key via a first-run onboarding wizard, or logs in to use a managed account. All structured data is stored locally in SQLite (via sql.js WASM), persisted to IndexedDB via `js/platform.js`. Binary assets (uploaded images) also use IndexedDB, referenced by key. When logged in, the server is the source of truth and local storage acts as a read cache.

## Architecture
Seven agents drive the learning experience. The **Coach** is the learner's companion, teacher, and assessor in one continuous conversation — it coaches toward the exemplar, evaluates responses, tracks progress, and updates the knowledge base inline.

- **Coach** (`MODEL_LIGHT`) -- the learner's companion, teacher, and assessor in one conversation; coaches toward the exemplar, evaluates responses, tracks progress via `[PROGRESS: 0-10]`, updates the course KB via `[KB_UPDATE]`, and updates the learner profile via `[PROFILE_UPDATE]`; replaces the old Guide, Activity Creator, and Activity Assessor agents; prompt in `prompts/coach.md`; uses `orchestrator.converseStream('coach', ...)` for real-time streaming; system prompt includes the program knowledge base (`data/knowledge-base.md`)
- **Course Owner Agent** (`MODEL_LIGHT`) -- initializes the course knowledge base from the course prompt (exemplar + learning objectives + learner profile); produces structured objectives with evidence descriptors, initial learner position, and empty insights; validated by `validateCourseKB()`
- **Course Creator Agent** (`MODEL_LIGHT`) -- coaches users through designing custom courses via a conversational chat; guides them to define an exemplar and learning objectives; each response includes a `[READINESS: 0-10]` signal that controls the "Create Course" button; prompt in `prompts/course-creator.md`; engine in `src/lib/courseCreationEngine.js`
- **Course Extractor Agent** (`MODEL_LIGHT`) -- extracts course markdown from a creation conversation; prompt in `prompts/course-extractor.md`
- **Learner Profile Owner** (`MODEL_LIGHT`) -- deep profile update on course completion (`orchestrator.updateProfileOnCompletion()` using `learner-profile-owner.md`)
- **Learner Profile Update** (`MODEL_LIGHT`) -- profile update from feedback/observations using `learner-profile-update.md`

Agent prompts live in `prompts/*.md` and can be edited independently of code. `orchestrator.converseStream()` streams coach responses token by token. `src/lib/courseEngine.js` is the state machine that orchestrates all agent calls and appends messages to the course conversation. A program knowledge base (`data/knowledge-base.md`) is automatically injected into the coach system prompt so it can answer questions about the AI Leaders program.

### Knowledge bases
Three knowledge bases drive personalization:

1. **Course KB** (`course_kbs` table) -- initialized by the Course Owner from the course prompt + learner profile. Contains the exemplar, structured objectives with evidence, learner position, and accumulated insights. Enriched after every assessment via `courseKBUpdate` from the Assessor.
2. **Activity KB** (`activity_kbs` table) -- per-activity record of instruction, tips, and all attempt results. Used for context in subsequent activities.
3. **Learner Profile** (`profile` + `profile_summary` tables) -- built incrementally from assessment results. Tracks active courses, mastered courses, strengths, weaknesses, and preferences. Deep LLM update on course completion.

### Output validation
All agent outputs pass through deterministic validators in `js/validators.js` (imported by `js/orchestrator.js`) before reaching the user:

- **`validateActivity`** -- instruction string present, tips array present, ends with "Upload" or "Submit", max 5 steps (4 content + final), no platform-specific shortcuts, no multi-site instructions, no non-browser apps, no DevTools, must produce visible work, content safety
- **`validateAssessment`** -- `achieved` boolean, `demonstrates` string, `strengths` array, `needed` string, `courseKBUpdate` object with `insights` array and `learnerPosition` string, content safety
- **`validateCourseKB`** -- exemplar, objectives array (each with objective + evidence), learnerPosition, insights array, activitiesCompleted number, status string, content safety

On failure, the agent call is retried once automatically.

### Onboarding
On first run, a full-screen onboarding wizard (with animated geometric background) presents three steps: Welcome (login or continue) → Name → API Key. There is no separate "about you" conversation -- the learner profile builds naturally from course activities and assessments. The header and nav are hidden during onboarding. Completion is tracked via an `onboardingComplete` flag in the `settings` table. If the user is already logged in on startup, onboarding is skipped entirely and the flag is stamped automatically. In development, `.env.js` seeds the key into storage but onboarding still runs.

### Exemplar-driven learning loop
The entire learning experience takes place in a **single continuous chat per course** with three phases:

1. **Course intro** (`course_intro`): The Course Owner generates the course KB from the course prompt. The Coach welcomes the learner and begins the conversation. "Start" begins learning.
2. **Learning** (`learning`): The Coach drives the entire learning loop in a single continuous conversation. It coaches the learner, creates activities inline, evaluates submissions (uploaded images or text) against the exemplar, and enriches the course KB with new insights via `[KB_UPDATE]`. Progress is tracked via `[PROGRESS: 0-10]`. The conversation continues until the learner achieves the exemplar.
3. **Completed** (`completed`): The Coach celebrates. A deep LLM profile update captures everything the learner demonstrated. A "Next Course" action returns to the courses list.

`src/pages/CourseChat.jsx` renders the entire course experience. `src/lib/courseEngine.js` manages all phase transitions and agent calls.

### Conversational UX
Everything in a course happens in one continuous chat. The course header has a **progress bar** showing the learner's position. All loading states appear as in-chat thinking indicators. The compose bar is fixed at the bottom with: Upload button (left), text area (center), Submit and Send buttons (right). Image upload and text submission are always available. **Action buttons** appear inline in the chat, labeled with the next step. All messages are persisted in the `course_messages` table so the conversation survives panel reloads.

### Learner profile updates
The profile updates via `[PROFILE_UPDATE]` signals from the Coach and deeply on course completion (LLM call via Learner Profile Owner). Profile feedback from settings also triggers an LLM update via Learner Profile Update. All updates run through a sequential queue in `src/lib/profileQueue.js` to prevent concurrent updates from overwriting each other. `ensureProfileExists()` guarantees a profile exists before any update. `mergeProfile()` in `src/lib/profileQueue.js` unions array fields (`activeCourses`, `masteredCourses`), merges preferences so agent responses can never accidentally lose accumulated data.

### Storage (SQLite)
All structured data is stored in an in-memory SQLite database powered by sql.js (WASM). The database is serialized to a `Uint8Array` and persisted to IndexedDB via `js/platform.js` under key `_sqliteDb` (debounced, plus on `visibilitychange`). `js/db.js` manages initialization, schema creation, persistence, and column migrations (via try/catch ALTER TABLE). `js/storage.js` provides the query API used by the rest of the app. Uploaded images remain in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` table. Text responses are stored directly in the `text_response` column of the `drafts` table.

**Tables:** `settings`, `preferences`, `profile`, `profile_summary`, `courses` (user-created), `course_kbs`, `activity_kbs`, `activities`, `drafts`, `auth`, `pending_state`, `course_messages`.

The `course_messages` table stores the unified conversation per course (role, content, msg_type, phase, metadata JSON, timestamp). The `course_kbs` table stores the evolving course knowledge base keyed by course_id. The `activity_kbs` table stores per-activity knowledge (instruction, tips, attempt history) keyed by activity_id. Activities are identified as `{courseId}-act-{number}`. Drafts store assessment results inline: `achieved`, `demonstrates`, `moved`, `needed`, `strengths`.

### Cloud sync
Optional login via `learn-service` (separate repo) enables cross-device data persistence. Login is never required -- the app works fully offline/locally. When logged in, the server is the source of truth: data is written to the server after every local save, and pulled from the server on startup/login. Local storage acts as a read cache for fast access.

- **Auth:** `js/auth.js` handles login/logout/token refresh via JWT access tokens (15 min) + refresh tokens (30 day, rotated on use). Tokens are stored in the SQLite `auth` table. On login, the auth user's name is synced into local preferences. If logged in, the onboarding wizard is skipped. The Personalization section in Settings is hidden when logged in (name comes from the service).
- **Remote storage:** `js/sync.js` is a thin client for `/v1/sync` endpoints on `learn-service`. `sync.save(key)` PUTs local data to the server (handles version conflicts by retrying with the server's version). `sync.loadAll()` GETs all data from the server and replaces local storage, removing any local data the server doesn't have. Version numbers are tracked in memory (not persisted) and rebuilt each session.
- **AI provider routing:** `js/orchestrator.js` routes API calls based on priority: (1) logged in → learn-service Bedrock proxy `/v1/ai/messages` via JWT auth, (2) Anthropic API key → direct Anthropic API. Logged-in users need no API key.
- **API key provisioning:** On login, if no local API key exists, the app checks for an admin-assigned key via `/v1/me/api-key` and auto-installs it.
- **Startup:** On bootstrap, if logged in, `sync.loadAll()` runs before reading local data. This ensures the app reflects the server state. Falls back to local cache if offline.
- **Settings UI:** When signed out, the Personalization section shows a name field and the AI Provider section shows the API key input. When signed in, Personalization is hidden (name comes from the service) and the API key section shows a note that AI is provided by the 1111 Learn account. Sign Out is in the header user dropdown, not the Settings page.

## Content hierarchy
Courses are defined as markdown prompts with a title (H1), description (first paragraph), exemplar (H2 section), and learning objectives (H2 section with bullet list). Built-in courses live as `.md` files in `data/courses/`. User-created courses are stored as markdown in the `courses` SQLite table. `js/courseOwner.js` `loadCourses()` merges both sources — they have the same parsed shape and work identically through the learning loop.

### Course creation
Users can create custom courses via a conversational chat with the Course Creator agent (`prompts/course-creator.md`). The agent coaches the user through defining an exemplar and learning objectives, assessing coherence at each step. Every agent response includes a `[READINESS: 0-10]` signal (stripped before display) that controls the "Create Course" button state (enabled at >= 7). When created, the course markdown is saved to the `courses` table, the courses cache is invalidated, and the course appears in the courses list — fully playable through the existing learning loop. Draft conversations are stored in `course_messages` with `course_id = create:{draftId}` and survive panel reloads. The creation engine lives in `src/lib/courseCreationEngine.js`.

The Course Owner agent transforms the course prompt into a structured course KB with objectives broken down into evidence descriptors. Activities are generated dynamically from the KB -- there are no predefined units, journeys, or rubrics.

## Key conventions
- The UI is a React app (React 18, React Router, Vite). Source lives in `src/` — pages, components, contexts, hooks, lib modules.
- Service modules (`js/db.js`, `js/storage.js`, `js/orchestrator.js`, `js/auth.js`, `js/sync.js`, `js/api.js`, `js/validators.js`, `js/courseOwner.js`, `js/platform.js`) are vanilla JS (ES modules) and stay outside `src/`. React components import from them.
- `js/platform.js` exports `resolveAssetURL()` (returns relative paths for fetching static assets) and `kvStorage` (IndexedDB-backed persistence for the SQLite database binary).
- Vite builds to `dist/` which is deployed to GitHub Pages. The entry point is `sidepanel.html` → `src/main.jsx` (initializes SQLite, then mounts React).
- Storage is abstracted in `js/storage.js` (SQLite via sql.js for structured data, IndexedDB for uploaded images). `js/db.js` manages the SQLite lifecycle.
- API calls go through `js/api.js`; agent orchestration through `js/orchestrator.js`.
- Agent system prompts are in `prompts/` as markdown files, loaded at runtime via `fetch()` with relative paths.
- Activities must be completable entirely in the browser. Learners upload images of their work or type text responses.
- Activities end with "Upload an image of your work." or "Hit Submit to submit your response."
- Keyboard shortcuts: Enter submits single-line inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs.
- URLs in activity instructions are automatically linkified.
- Views: `onboarding`, `courses`, `courses/create` (course creation chat), `course` (single continuous chat), `settings`.
- View transitions: navigating deeper slides left, going back slides right, lateral navigation fades up. List items stagger in. All animations respect `prefers-reduced-motion`.

## CI/CD
Three GitHub Actions workflows handle testing, versioning, and deployment:

### Staging workflow (`.github/workflows/staging.yml`)
Runs on every push to `staging`: runs tests, builds, determines RC version, generates release notes via Claude (Haiku), creates a GitHub **pre-release** tag.

### Release workflow (`.github/workflows/release.yml`)
Runs on every push to `main` (via PR from `staging`): runs tests, builds, calls Claude (Haiku) for semver bump and release notes, creates a GitHub Release tag.

### Deploy workflow (`.github/workflows/deploy-web.yml`)
Runs on every push to `main`: builds the app and deploys to GitHub Pages at `learn.philosophers.group`.

### Branch protection
`main` is protected: direct pushes are blocked, PRs require approval and passing status checks. By convention, `main` only accepts PRs from `staging`. Branch protection is configured via `scripts/setup-branch-protection.sh`.

### Required secrets
- `ANTHROPIC_API_KEY` -- for Claude-powered version analysis

## File structure
```
sidepanel.html           Vite entry point (mounts React)
sidepanel.css            Global styles
vite.config.js           Vite build config
CNAME                    GitHub Pages custom domain
lib/
  sql-wasm.js            Vendored sql.js (SQLite WASM engine)
  sql-wasm.wasm          SQLite WASM binary
js/                      Service modules (vanilla JS, imported by React)
  platform.js            Asset URL resolution + IndexedDB kvStorage
  db.js                  SQLite database lifecycle (init, query, persist)
  storage.js             SQLite query layer + IndexedDB for uploaded images
  courseOwner.js          Course prompt loading, parsing, KB updates
  api.js                 AI API client (Anthropic direct + Bedrock proxy support)
  orchestrator.js        Agent orchestration (prompt loading, context assembly, model routing)
  validators.js          Pure validation functions (used by orchestrator + tests)
  auth.js                Authentication module for learn-service (login, logout, token refresh)
  sync.js                Cloud data sync (push/pull with optimistic locking)
src/                     React app
  main.jsx               Entry point: db init, React mount
  App.jsx                Routes + redirect logic
  contexts/
    AppContext.jsx        Course/progress/preferences state (useReducer)
    AuthContext.jsx       Auth state wrapping js/auth.js
    ModalContext.jsx      Modal show/hide + portal
  hooks/
    useViewTransition.js  Route-change animations
    useAutoResize.js      Textarea auto-resize
  lib/
    syncDebounce.js       Debounced cloud sync
    profileQueue.js       Sequential profile update queue + merge logic
    courseEngine.js       Exemplar-driven learning loop (all phase transitions, agent calls, message appending)
    courseCreationEngine.js  Course creation conversation state machine
    helpers.js            esc, renderMd, linkify
    constants.js          VIEW_DEPTH, COURSE_PHASES, MSG_TYPES
    confetti.js           Confetti burst on course completion
  components/
    AppShell.jsx          Header + nav + main wrapper + transitions
    PasswordField.jsx     Show/hide toggle input
    OnboardingCanvas.jsx  Animated geometric mesh
    modals/
      LoginModal.jsx      Email/password login form
      ConfirmModal.jsx    Generic confirm dialog
      ResponseModal.jsx   Submission modal (image upload, text, or both)
    chat/
      ChatArea.jsx        Scrollable container, auto-scroll
      ComposeBar.jsx      Upload + textarea + submit + send
      ActionButton.jsx    Inline action button (labeled next-step CTA)
      ProgressBar.jsx     Course progress bar
      ThinkingSpinner.jsx Inline loading indicator
      UserMessage.jsx     User chat bubble
      AssistantMessage.jsx AI response with markdown
      InstructionMessage.jsx Activity instruction + tips + linkified URLs
      DraftMessage.jsx    Draft submitted indicator
      FeedbackCard.jsx    Assessment feedback (achieved, demonstrates, strengths, needed)
  pages/
    CoursesList.jsx       Course cards with phase status
    CourseChat.jsx        Unified course chat (guide + activities + feedback)
    CourseCreate.jsx      Course creation chat with AI coaching
    Settings.jsx          API key, name, profile feedback
    onboarding/
      OnboardingFlow.jsx  3-step wizard with canvas backdrop
      WelcomeStep.jsx     Login or continue
      NameStep.jsx        Name input
      ApiKeyStep.jsx      API key input
prompts/                 Agent system prompts (markdown)
  coach.md               Coach agent prompt (coaching, activity creation, assessment)
  course-owner.md        Course Owner agent prompt
  course-creator.md      Course Creator agent prompt
  course-extractor.md    Course Extractor agent prompt
  learner-profile-owner.md  Deep profile update prompt (course completion)
  learner-profile-update.md Profile feedback/observation update prompt
data/
  courses/               Course prompt files (markdown)
    foundations.md        Foundations course
  knowledge-base.md      Program knowledge base (injected into guide prompt)
assets/                  Icons and images
tests/
  courses.test.js        Course prompt validation tests
  validators.test.js     Output validator unit tests
  platform.test.js       Platform utility tests
  storage.test.js        SQLite storage round-trip tests
dist/                    Build output (gitignored, deployed to GitHub Pages)
PRIVACY.md               Privacy policy
.github/
  workflows/
    release.yml          Production release (GitHub Release tag)
    staging.yml          Release candidate (pre-release tag)
    deploy-web.yml       GitHub Pages deployment
```

## Documentation
Detailed docs live in `docs/` and are linked from `README.md`:
- `docs/architecture.md` -- agents overview, knowledge bases, storage, content hierarchy, data flow, file structure
- `docs/agent-lifecycle.md` -- full walkthrough of the exemplar-driven learning loop with every agent call, inputs, outputs, and validation
- `docs/cloud-sync.md` -- auth, remote storage, AI provider routing
- `docs/releases.md` -- CI/CD, versioning, branch protection, permissions, secrets, course prompt format
- `CONTRIBUTING.md` -- dev setup, workflow, guidelines, submitting changes

## Rules for every change
1. Update `README.md` if you add, remove, or rename any user-facing feature.
2. Update the relevant doc in `docs/` if you change architecture, agents, storage, sync, or CI/CD.
3. Update `CONTRIBUTING.md` if you change the development workflow.
4. Keep this `CLAUDE.md` in sync with the actual architecture. It is the authoritative reference for AI assistants.
5. Accessibility is non-negotiable: every interactive element must be keyboard-operable and have an accessible name.
6. When editing agent prompts, test with a real API key to verify JSON output format.
7. Never commit API keys or secrets.
8. Activities must be completable entirely in the browser -- never reference desktop apps, terminals, or file system operations.
9. Run `npm test` before submitting PRs. Tests must pass in CI on both `staging` and `main`.
11. **Data schema changes:** If you add, remove, rename, or restructure any SQLite table or column, update the `CREATE TABLE` DDL and `MIGRATIONS` array in `js/db.js`. Update any affected getter/setter functions in `js/storage.js` to handle the new shape. Update `mergeProfile()` in `src/lib/profileQueue.js` if the learner profile shape changed.
12. **Privacy:** Never commit API keys or secrets. No telemetry is collected. Uploaded images and user data stay on-device (or on the user's learn-service account if logged in).
