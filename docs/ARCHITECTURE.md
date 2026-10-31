# plato Architecture — subsystem deep-dives

Detailed design notes and incident history for plato's load-bearing subsystems.
`CLAUDE.md` carries the one-line invariants; this doc carries the *why* and the
*how it broke*. Read the relevant section before changing one of these systems.

## Data & content model

- Login required — all data is server-side, no offline mode. Auth: JWT access
  tokens (15 min) + refresh tokens (30 day), stored in localStorage
  (`plato_auth`). Login accepts email or username. Users have a unique
  `username` (auto-generated if unset, editable, 3–30 chars
  alphanumeric/hyphens/underscores).
- 2 Lambda functions: API Gateway (buffered CRUD) + Function URL (streaming SSE
  for AI chat).
- 5 DynamoDB tables: users, invites, refresh-tokens, sync-data, audit-log.
- Content stored as `_system` sync-data: `prompt:*`, `lesson:*`,
  `knowledgeBase`, `settings`.
- Prompts are bundled in `client/prompts/*.md` and upserted to DB on every
  server startup — admins cannot edit prompts directly.
- User-created lessons stored under the user's own sync-data:
  `lessons:custom-*`. User-created lesson IDs start with `custom-`.
- Classroom branding (colors, logo, name) stored in `_system` settings, fetched
  via `/v1/branding` (public, no auth).
- Data changes to existing records go through [data migrations](#data-migrations)
  — never ad-hoc scripts against prod.

## Data migrations

Every install upgrades itself — self-hosted ones included — so schema/data
changes ship as migrations in `server/src/lib/migrations.js` (`MIGRATIONS`,
append-only). They run **once per install, automatically, on cold start**
(after prompt seeding, in `server/src/index.js` and `dev-sqlite.js`), bounded
to 20 s so a slow run never holds the first request; code must therefore
tolerate unmigrated data.

**Rules every migration follows**
- **Additive and idempotent.** Add fields/records, or change a value only via a
  conditional write that still sees the exact old value. Never delete or
  rename. Learner work (`messages:*`, `screenshot:*`, `lessonKB:*`,
  `courseProgress:*`, `lessons:*`) is never rewritten.
- **Rollback-compatible with the release being upgraded from** (Beta-RC-232 for
  the Nov 2026 launch): that release's code must keep serving the migrated
  data, so redeploying it is a safe rollback.
- **Failure is non-fatal and retried.** A migration is recorded in
  `_system:migrations.applied` only when it finishes with zero errors; anything
  else reruns on the next cold start. A lock in the same record (optimistic
  version write via `db.createSyncData` / `putSyncData`) stops concurrent Lambda
  containers from running it twice. Results log as `migration_applied` /
  `migration_failed`.

**Before merging a migration**
- `server/tests/migrations/upgrade-from-rc232.test.js` seeds an RC-232-shaped
  fixture (`tests/migrations/fixtures/rc232.js`), runs every migration, and
  fails on any record removed or any change outside its `ALLOWED` list. It
  checks a second run is a no-op, then runs **Beta-RC-232's own route handlers**
  (extracted from the git tag; CI fetches it) against the migrated db. Extend
  `ALLOWED` and the fixture in the same PR as the migration.
- `node server/scripts/migrate.js` reports, read-only, what each pending
  migration would change on any backend (DynamoDB table names are
  env-overridable for rehearsals on restored copies; `--apply` only there).

`putSyncData` with no expected version is an unconditional overwrite; use
`db.createSyncData` when you mean "create only if absent".

## AI agents

9 AI agents, all sharing one open source model on Bedrock (prompt files in
`client/prompts/`; see [AI provider & model choice](#ai-provider--model-choice)).
Each prompt file has an HTML comment header documenting what it reads, who calls
it, and its purpose:

- **coach** — Reads: lesson prompt, lesson KB, learner profile, program KB, course name + cross-lesson progress note. The main learner-facing agent.
- **lesson-creator** — Reads: program KB. Helps admins design lessons via conversation (and is aware lessons can belong to a persistent course).
- **lesson-owner** — Reads: lesson prompt, learner profile. Initializes per-lesson KB.
- **lesson-extractor** — Reads: conversation text only. Extracts lesson markdown from creation chat.
- **knowledge-base-editor** — Reads: program KB. Helps admins create/edit the KB via conversation.
- **knowledge-base-extractor** — Reads: existing KB + conversation. Merges changes into updated KB markdown. **Summarizes, doesn't transcribe** — it produces a concise reference (a few KB), because the full KB is re-appended to every coach turn and an unbounded KB overflows the context window (and silently truncates against the extractor's own `maxTokens`). The editor (`AdminCustomizer`/`AdminKBSetup`) windows live turns to the last 15, like the lesson creator.
- **learner-profile-owner** — Reads: learner profile, lesson KB. Full profile update on lesson completion. Only revises the "soft" fields (name, goal, strengths, weaknesses, preferences, summary); `masteredLessons`/`activeLessons` are **stripped from its input and not requested in its output** — they are system-managed bookkeeping arrays that grow without bound, and `mergeProfile` reunions them from the stored profile. The completion path records the just-mastered `lessonId` in code (`profileQueue.js`). Echoing those arrays used to inflate the agent's JSON past `maxTokens`, truncating it into an unparseable response (#228).
- **learner-profile-update** — Reads: learner profile (minus the bookkeeping arrays), activity context. Incremental profile updates during lessons; same soft-fields-only contract as `learner-profile-owner`.
- **course-progress-update** — Reads: prior course summary, just-completed lesson KB, course lesson list. Maintains the per-learner `courseProgress:<courseId>` note injected into the coach as `course.progress`.

Context appended at runtime (`client/js/orchestrator.js`):

- **Program Knowledge Base** appended to agent system prompts for agents in `KB_AGENTS`.
- **Lesson Catalog**: public lessons for `PUBLIC_CATALOG_AGENTS` (coach); all
  lessons with `[PRIVATE]` tags for `ADMIN_CATALOG_AGENTS` (lesson-creator,
  knowledge-base-editor).
- Knowledge base is created/edited by admins via the KB Editor agent in the
  Customizer (not directly editable).

### Learner language (#240)

Every agent writes in the learner's browser language (`navigator.languages[0]`
/ `navigator.language`). `client/js/language.js` maps the code to a language
name and `withLanguage()` appends a `## Language` section to each of the 9
agents' system prompts in `orchestrator.js`. Rules:

- **English or an unmapped language adds nothing**, so English learners'
  prompts are byte-for-byte what they were. Unknown codes fall back to
  English rather than guessing.
- **The directive names every literal plato parses out of agent output** as
  "keep in English": the bracketed tags (`[PROGRESS: N]`, `[KB_UPDATE:]`,
  `[PROFILE_UPDATE:]`, `[READINESS: N]`, `[DRAFT]`), JSON keys and fixed values
  (`"status": "active"`), lesson markdown headings (`## Learning Objectives`,
  `## Exemplar`, `## Coach Directive`), and the `- Can ` objective prefix that
  `validateLessonMarkdown` requires. A translated tag or heading would break
  parsing silently, so if you add a new parsed literal to a prompt, add it to
  the directive too.
- Admin-side agents (lesson creator/extractor, KB editor/extractor) follow
  the *admin's* browser, so lessons and the KB are authored in that language.
- Verified against Qwen3-VL on Bedrock (Spanish, 3 runs × 7 agents, outputs
  run through plato's own parsers): all tags, JSON, headings, and `- Can `
  objectives parsed; prose came back in Spanish. Internal KB fields the coach
  reads but learners never see (`evidence`, `learnerPosition`) sometimes stay
  English because their input (the lesson) is English — harmless.

## AI provider & model choice

plato runs **one model for all nine agents** — no per-agent routing. It is
declared once as `LLM` in `server/src/lib/ai-provider.js`, mirrored in
`client/js/api.js`, and injected into plugins as `ctx.LLM`. Bedrock is the only
backend, in production and in local dev; the direct Anthropic API provider was
removed when plato moved to open weights.

Current model: **`qwen.qwen3-vl-235b-a22b`** (Qwen3-VL 235B A22B, Apache-2.0).

### Why this model

Selected against the models available on Bedrock in us-east-2 by applying four
constraints in the following order — the fourth is what ultimately decides it:

1. **Bedrock-only is an institutional requirement** (UIC). Published weights are
   irrelevant if AWS doesn't host the SKU in our region — the Bedrock catalog,
   not the open-weight ecosystem, defines the candidate pool. It also means
   third-party latency benchmarks don't transfer; latency is a property of the
   host.
2. **Image input is a hard filter.** Learners paste screenshots into the coach
   (`metadata.imageKeys`), so a text-only model can't serve plato at all. Of the
   43 open-weight model IDs in us-east-2, only 12 accept `IMAGE`, and most of
   those are small (Ministral 3B–14B, Nemotron Nano, Palmyra Vision 7B, Gemma 3
   4B/12B). That rules out GLM 5, DeepSeek V3.2, gpt-oss, Nemotron Super,
   MiniMax, plain Qwen3-235B, Llama 3.3, and `kimi-k2-thinking` regardless of
   how they score.
3. **Reasoning models are disqualified.** plato's contract is *literal tags in
   visible text* — `[PROGRESS: n]`, `[KB_UPDATE: {…}]`, `[PROFILE_UPDATE: {…}]`,
   parsed by regex plus a brace-walk in `lessonEngine.js`. Models that emit
   `reasoningContent` spend output budget on traces that never reach the parser.
4. **Tag compliance and completion filter the rest.** Measured against the real
   `coach.md` across five scenarios: Qwen3-VL hit 3/3 on the required
   `[PROGRESS]`+`[KB_UPDATE]` pair and awarded `10` on 5/5 exemplar-achieved
   trials (plato completes a lesson only at `progress >= 10`). Gemma 3 27B
   dropped a `[PROGRESS]` tag (2/3). Mistral Large 3 and Pixtral Large failed
   outright — Mistral called a solid red image "black".
5. **The license must be OSI-approved — and this decides it.** plato is
   **AGPL-3.0**; the goal was an *open source* model, not merely an open-weight
   one. "Open weight" only means the parameters download. The **Llama 4 Community
   License** (700M-MAU threshold, acceptable-use policy, "Built with Llama"
   naming) and the **Gemma Terms of Use** both fail the Open Source Definition on
   field-of-use and non-discrimination grounds and are not OSI-approved.
   **Qwen3-VL's Apache-2.0 is the only OSI-approved license in the eligible set**,
   which leaves the set with exactly one member.

   Don't re-derive this as a liability question. Because plato calls Bedrock and
   never redistributes weights, the Llama clauses are close to inert *as legal
   exposure* — that reasoning nearly selected Llama 4 on an earlier draft. The bar
   is definitional (is the model open source?), not a risk assessment.

Note when scoring tag compliance: `[PROGRESS]` and `[KB_UPDATE]` are required
every response, but `[PROFILE_UPDATE]` is **conditional** on the learner
revealing something. Scoring all three as mandatory produces false failures.

**The trade this makes:** `us.meta.llama4-maverick-17b-instruct-v1:0` measured
faster (p50 526 ms vs ~1.1 s TTFT), cheaper, with no observed latency tail, and
equal on every correctness measure — but it is **license-ineligible**. It is the
tested one-line fallback if Qwen's tail becomes a production problem; taking it
means **knowingly dropping below the open source bar**, so treat that as a
conscious, documented trade rather than a config tweak. Against the incumbent
Haiku the eligible choice costs only ~100 ms of p50 latency and saves 1.9× on
cost, so open source did not mean a worse product.

**Latency caveat:** Qwen3-VL's p50 TTFT is ~1 s, but two ad-hoc runs saw **47 s**
and **36 s** on the same payload. Neither reproduced across 30 controlled
samples, so the frequency is unmeasured. Watch for >5 s TTFT in the log-watch
alarm.

**Known limitation, not model-specific:** no model tested — including Haiku 4.5 —
reliably detects learner *regression*. Given a retraction from `progress: 8`,
Gemma scored 4/2/2 (appropriate), Haiku 5/6/4, Qwen3-VL 7/5/5, Llama 4 7/7/7.
That's a `coach.md` prompt weakness, independent of which model runs behind it.

Any replacement model must clear all five bars above — including the license one.
Anthropic model IDs stay in `MODEL_MAP`, so falling back to Claude is a one-line
`LLM` change, with the same open-source caveat as Llama 4 (more so — Haiku is
proprietary). Full evaluation, tables, and rejected candidates:
[`docs/MODEL_SELECTION.md`](MODEL_SELECTION.md).

### Why the Converse API

Non-Anthropic Bedrock models are only reachable through **Converse /
ConverseStream**. This matters because the legacy `InvokeModel` path does **not**
reject them: called with `qwen.*` or `openai.*`, it returns **HTTP 200** with an
OpenAI-shaped body (`choices[0].message.content`), so callers reading
`content[0].text` silently get `undefined`. A wrong-API mistake here fails
quietly, not loudly.

Rather than teach every caller a second dialect, plato keeps the **Anthropic
Messages shape as its internal wire format** and translates only at the Bedrock
boundary, in `server/src/lib/converse.js`:

- Request: `{ max_tokens, system, messages }` → `{ inferenceConfig.maxTokens,
  system: [{text}], messages: [{role, content: [{text} | {image}]}] }`. Base64
  image blocks are decoded to bytes and their media type mapped to a Converse
  `format`.
- Response: `output.message.content[]` → `{ content: [{type:'text', text}],
  usage: {input_tokens, output_tokens}, stop_reason }`. Multiple text blocks are
  **concatenated** so a tag split across blocks still parses; `reasoningContent`
  blocks are dropped.
- Stream: `contentBlockDelta` → `content_block_delta` / `text_delta`, which is
  the only event shape `parseSSEStream` in `client/js/api.js` yields text for.
  **A stream is complete only when it ends with `data: [DONE]`.** If Bedrock
  fails mid-stream the route sends `{type:'error'}`; `parseSSEStream` throws on
  that, and also throws when the stream ends without `[DONE]` (connection cut,
  Lambda timeout), so callers show an error instead of parsing and saving a
  truncated reply as a real turn. `PlatoStreamFunction` has `Timeout: 120` so a
  slow generation hits the 115 s `BEDROCK_TIMEOUT_MS` (clean error event)
  before Lambda kills it.

Converse event order was verified identical for Anthropic and open-weight
models (`messageStart → contentBlockDelta* → contentBlockStop → messageStop →
metadata`), so no per-provider chunk handling is needed. Because the translation
is pure functions with no AWS SDK dependency, it's unit-tested without network
access (`server/tests/lib/converse.test.js`).

Converse authorizes under the same `bedrock:InvokeModel` /
`bedrock:InvokeModelWithResponseStream` IAM actions, so `template.yaml` needed no
change.

### No prompt caching

Prompt caching is **Claude-exclusive on Bedrock**. Verified: Haiku 4.5 accepts
`cachePoint`, while Qwen3, Kimi K2.5, DeepSeek v3.2, GLM 5, and gpt-oss-120b all
hard-error with `AccessDeniedException: You invoked an unsupported model or your
request did not allow prompt caching`. Do not add cache-point plumbing while
plato runs a non-Anthropic model — it cannot work. (For the record, Claude's
minimum cacheable prefix is 4096 tokens, and `coach.md` alone is ~3,685 — below
the floor, where Bedrock silently no-ops rather than erroring.)

### Cost

Qwen3-VL is **~2.2× cheaper** than Haiku 4.5: $0.53/$2.66 per 1M input/output
tokens versus $1.00/$5.00. At measured token counts that's ~$0.040 per
16-exchange lesson versus ~$0.088. Note that Haiku 4.5 is absent from the AWS
Pricing API, so its rate is the Anthropic first-party price used as a proxy,
while Qwen3-VL's is real us-east-2 on-demand.

**Latency is the trade, not cost.** Measured on the real `coach.md` payload,
Qwen3-VL's time-to-first-token is roughly 2–6 s against Haiku's ~1.3–3.8 s, and
it is less consistent — one observed outlier hit 47 s TTFT. Streaming hides some
of this, and `BEDROCK_TIMEOUT_MS` (115 s) still bounds the worst case, but the
tail is real and worth watching in the log-watch alarm.

## Image & conversation persistence (#191, #193)

A learner's chat history for a lesson lives in one `messages:<lessonId>`
sync-data record (append-only via `saveLessonMessages`); progress lives
separately in `lessonKB:<lessonId>`.

**Pasted/uploaded images are NOT embedded in the messages record.** Each image
is its own `screenshot:<key>` record, and the message stores only
`metadata.imageKeys`. This is load-bearing:

- DynamoDB caps a single item at 400 KB. Inlining base64 screenshots blew the
  `messages:` record past that limit. The write then failed, but
  `client/js/storage.js`'s `putSyncData` swallowed the non-409 error, so the
  in-memory cache looked fine until the next `loadAll()` (on tab refocus)
  replaced it with the stale server copy — the learner's conversation silently
  vanished while the small `lessonKB` record survived.
- Images are compressed client-side on paste
  (`client/src/lib/imageCompression.js`) to stay well under the per-record
  limit, persisted one-per-record, and excluded from the bulk `GET /v1/sync`
  payload (fetched on demand by key).
- `ComposeBar.addImagesFromFiles` reads files via `FileReader` with
  `Promise.allSettled` (not `all`) so one unreadable file can't discard a whole
  batch, and surfaces the underlying `DOMException.name` in the alert
  (e.g. `NotReadableError` = file locked by antivirus / in use, `NotFoundError`
  = a OneDrive "files on-demand" entry not downloaded locally). Reads can also
  be blocked by a browser extension injecting a content script into the page.
  The opaque "Failed to read image" message that hid all of this was issue #228.
- `resumeLesson` re-hydrates `imageKeys` → data URLs for rendering via
  `hydrateMessageImages`. Legacy messages that still embed `imageDataUrls`
  directly render unchanged.
- A lazy, idempotent migration (`migrateLegacyImages`, run from `resumeLesson`)
  heals pre-fix conversations whose embedded base64 already bloated the record:
  it extracts each embedded image into a compressed `screenshot:*` record and
  rewrites the conversation record slim so the lesson can be continued. The
  migration is **skipped while impersonating** (`resumeLesson` must stay
  read-only for the "View as User" audit — writes lack `?asUserId` and would
  land on the admin's own account).
- `putSyncData` returns a durability boolean and logs rejected/failed writes
  instead of swallowing them.
- The `LessonChat` resume effect keys on stable values (`lessonGroupId`, lesson
  presence) — **never the `lesson` object identity**, which changes on every tab
  refocus and used to re-run the effect and reset the conversation mid-lesson.

## Link attachments

A learner attaches a web page to a coach message via a link button in
`ComposeBar` (next to the image button). Fetching + extraction happen
**server-side** — the browser can't fetch cross-origin pages (CORS), and
server-side is where the SSRF defense must live.

- **Endpoint:** `POST /v1/links/fetch` (`server/src/routes/links.js`, buffered
  API function); `client/src/lib/links.js`'s `fetchLinkContent` calls it on
  attach so the chip shows the real title immediately.
- **Extraction** (`server/src/lib/link-extractor.js`): `fetchUrlContent` does a
  plain fetch, `extractReadable` runs `@mozilla/readability` over a `linkedom`
  DOM and converts the cleaned HTML to block-preserving text (Readability's
  `textContent` fuses words across elements), falling back to a whole-body strip
  for non-article pages. This is the **pluggable seam** — swap only the fetch
  step for a headless browser / reader service to handle JS-rendered SPAs later
  (the **known v1 gap**: SPAs return little text).
- **SSRF defense** (`server/src/lib/url-guard.js`) — the headline risk, since
  the server fetches user URLs from inside AWS. http/https + port allowlist, no
  embedded credentials; rejects any loopback/private/link-local/reserved address
  (incl. `169.254.169.254` and every IPv6 representation of those ranges —
  compressed, expanded, hex/dotted IPv4-mapped); manual redirects (≤5 hops)
  re-validated each hop; 10 s timeout, 3 MB cap, content-type allowlist, ~50 k
  char truncation. **DNS rebinding is closed by pinning:** the fetch agent's
  `connect.lookup` (`safeLookup`) validates the resolved address and the socket
  connects to *that* IP, so a low-TTL host can't pass an up-front check then
  re-resolve to an internal IP (the classic resolve-then-fetch TOCTOU). Uses
  undici's own `fetch` + `Agent` (Node's built-in `fetch` rejects an external
  undici dispatcher).
- **Link text is untrusted, user-controlled content.** It's whatever the linked
  page says, so it can contain prompt-injection attempts ("ignore previous
  instructions…"). It's framed to the coach as `[REFERENCE CONTEXT — Learner
  attached a web page for your review]` with an explicit trailing instruction
  that this is reference material, not evidence of completion unless the learner
  confirms it. Claude is generally robust to injection, but treat page content
  as untrusted — don't add code paths that act on it as instructions.
- **Recall is this-turn-only (image parity).** `buildUserParts` (`lessonEngine.js`)
  injects the page text into the coach call on the attach turn (ordered text →
  links → images); it's never persisted or re-sent (later turns see a `[link]`
  placeholder). Only `metadata.links: [{ url, title }]` is persisted — so no
  400 KB risk, no new sync record, no hydration; chips render straight from that
  metadata on resume.
- **Coach interpretation guidance** (`client/prompts/coach.md`): the prompt
  explicitly tells the coach NOT to treat page content as evidence of completion
  unless the learner confirms it — e.g., if a lesson asks them to publish a blog
  post and they share their site, the coach should ask "Is this the published
  post you're submitting?" rather than assuming visible content is final. This
  prevents the hallucination failure mode where a learner shares their
  work-in-progress portfolio site for reference and the coach infers completion
  from content that doesn't exist or isn't finished yet.

## Composing and reply reveal (#247)

**Composing during a reply.** `ComposeBar` has two locks. `disabled` turns
the whole composer off (read-only views such as View as User). `sendDisabled`
only blocks sending: the textarea, attachments, and links stay usable, so a
learner can write the next message while the coach is still replying. The
send button is disabled, the keyboard shortcut does nothing, and the hint
reads "Send when the reply finishes". Every chat (lesson, lesson editor, KB
editor, KB setup) passes its busy state as `sendDisabled`.

**Send key.** The `sendKey` preference (`'mod-enter'`, the default, or
`'enter'`) decides whether plain Enter sends. Cmd/Ctrl+Enter always sends,
Shift+Enter is always a new line, and Enter that confirms an IME composition
never sends (`isSendKeystroke` in `client/src/lib/chatPrefs.js`). The current
shortcut is visible next to Send and is the textarea's accessible description.

**Reveal.** `useStreamedText` types replies out at about 33 characters a
second, but `nextRevealPosition` keeps it at most ~40 ticks (~1.2 s) behind the
stream. Once the stream ends, the rest drains in under a second, so a fast
model never leaves a long typing backlog. Returning to a background tab shows
everything buffered at once. **Instant mode** shows each chunk as it arrives.
It's on with the `instantText` preference, or by default when the device
prefers reduced motion; an explicit "off" wins. The hook still goes `null`
only after the reveal catches up with a finished stream, which is the signal
chat pages use to append the persisted message.

Both preferences live in the learner's `preferences` sync record and are set
in Settings → Chat, which saves on change.

## Behind this response (#411)

Every chat reply can show which of plato's agents worked on it, what each
read, and what it did. A collapsed **"Behind this response · Coach, Learner
profile"** button sits between a message and its reply
(`client/src/components/chat/AgentActivity.jsx`). It's a real button with
`aria-expanded`, so it's reachable by Tab in the chat log, and Alt+Arrow
message navigation is unchanged.

The content comes from `client/src/lib/agentActivity.js`, built from what
plato already parses out of agent output: progress before and after, the
coach's KB notes and learner position, the profile observation handed to the
learner-profile agent, the unit-progress hand-off on completion, plugin
enrichments, and readiness for the authoring agents. **It never shows the
model's raw reasoning** (`converse.js` drops reasoning blocks, and Qwen3-VL's
isn't a reliable account of what plato did). Notes are clipped to 280
characters, at most 5 per agent.

Storage: the assistant message carries `metadata.agents` =
`[{ agent, label, read?, did?, notes? }]`. In lessons it's persisted in
`messages:<lessonId>` (a few hundred bytes a turn). Messages from before #411
simply have no disclosure. The admin chats (lesson editor, KB editor, KB
setup) keep it in session only; their saved conversations store just role and
content.

Background agents (learner profile, unit progress) are listed as "Asked to…":
the reply records the hand-off, not whether the background run later
succeeded.

## Chat auto-scroll (#319, #321)

`useStickToBottom` (consumed by `ChatArea`) follows streamed output while the
learner is at the bottom, holds still when they've scrolled up, and always jumps
on send. Three traps here each produced a shipped-but-broken fix:

1. **The chat log is not the scroll container** — it has no `overflow`, so it
   never emits `scroll`. #321 listened there, so its handler never fired and
   auto-scroll re-fired on every streamed character. Hence the **capturing**
   `window` listener: `scroll` doesn't bubble but does capture, so it sees
   whichever element scrolls without naming it.
2. **There is no single scrollport to resolve.** `<main>` declares
   `overflow-y-auto`, but whether it or the document scrolls depends on the whole
   flex chain (`h-full` on html/body/#root, `flex-1` with no `min-h-0`,
   `min-h-[calc(...)]` on `LessonChat`'s root). Setting `scrollTop` on a
   non-scrolling element is a **silent no-op**, indistinguishable from an unwired
   feature — so the pin writes to every scrollable ancestor plus `window`.
3. **The compose bar sits inside the scroll container**, after the log, so
   `scrollIntoView` on a sentinel stops short of the true bottom and hides the
   newest message behind the fixed overlay. Request `scrollTop = scrollHeight`
   and let the browser clamp. **Don't restructure the compose layout to work
   around scrolling** — the inline+fixed pair is deliberate (inline reserves
   space in flow).

Verify changes by hand with the compose bar in *both* states (fixed mid-lesson,
inline at the end of a short one); `client/tests/stickToBottom.test.js` covers
only the decision layer.

## Invite system

Admins invite users via email or shareable link. Invites expire after 7 days (TTL enforced in DynamoDB/SQLite). All invite operations are audit-logged.

### Email invites

- **Creation:** `POST /v1/admin/invites` (single) or `/v1/admin/invites/bulk` (up to 200). Bulk supports CSV upload.
- **Delivery:** SES email (`server/src/lib/email.js`) with signup URL: `{APP_URL}/signup?token={inviteToken}`. Every interpolated value is escaped (`escapeHtml`), the theme color must be a hex color (`safeColor`), and the From display name is sanitized (`fromHeader`) — classroom and inviter names are admin-editable.
- **Validation:** Invite token must exist, status `pending`, TTL not expired, and **email must match** the invite.
- **One-time:** Marked `used` on signup; cannot be reused.

### Link invites (shareable, reusable)

Added to enable bulk onboarding without collecting emails upfront (e.g., sharing in company Slack channels).

- **Creation:** `POST /v1/admin/invites/link` creates a single organization-wide link. If one exists, it's deleted first (regenerate = delete old + create new).
- **Retrieval:** `GET /v1/admin/invites/link` returns the active link or `null`.
- **Deletion:** `DELETE /v1/admin/invites/link` revokes the link immediately.
- **Schema:** Same `invites` table, but `email: null` and `isLink: true`. Added fields: `usageCount` (incremented on each signup), `maxUsages` (optional limit, currently `null` = unlimited).
- **Validation:** Any email accepted (vs. email invites that must match). TTL and status still checked.
- **Usage tracking:** `incrementLinkUsage()` atomically increments `usageCount` on signup with a conditional update that enforces `maxUsages` if set. This prevents race conditions where concurrent signups could exceed the limit. The check-then-increment at the route level would be racy; the database operation is the authoritative gate. Link is marked `used` only if `maxUsages` reached (rare; currently unlimited).
- **Security:** 7-day TTL, audit-logged, clear UI warnings about sharing risks, email still required at signup (no anonymous accounts).
- **UI:** Admin → Users → Invite Users → "Link" tab. Shows URL with copy button, usage stats, expiry date, and security warning. Regenerate/delete actions have confirmations.

### Wait list (#363)

People ask to join; an admin invites them later. Integrator-facing API guide: [`WAITLIST_API.md`](WAITLIST_API.md).

- **Join:** `/waitlist` page, linked from sign-in when the list is open. It asks for name, email, group (optional), and the custom user fields, with required fields enforced.
- **API:** `POST /v1/waitlist` (public) takes `{ name, email, userGroup, customFields }`. It works when the list is open, or with `Authorization: Bearer <key>` from an outside form, even when closed. Send the key from a server, not a web page. The reply is `202 { ok: true }` for any valid input, including an email that already has an account, invite, or entry, so it never reveals who is registered. `GET /v1/waitlist` returns `{ open }`.
- **Storage:** rows in the `invites` table with `status: 'waitlist'`, no `ttl` (they never expire), and a `profile` of `{ name, userGroup, customFields }`. Pending-only lookups skip them, so a wait-list token can't sign up. New entries are keyed `inv_wl_<sha256(email)>` (`waitlistTokenFor`) and written create-only, so two concurrent joins for one address can't both insert; the lookup before the insert stays for older, randomly-keyed entries.
- **Config:** `_system:waitlist` = `{ open, apiKeyHash }`, kept out of `_system:settings` so a stale settings save can't bring back a revoked key. The key is shown once; only its SHA-256 is stored.
- **Admin:** Users → **Wait List** filter, with Invite and Remove per row; click a row to edit the entry (`/plato/users/waitlist/:token`: name, email, group, custom fields — same validation as joining, and a new email must not belong to a user, pending invite, or other entry). Users → **Wait List** button to open or close the form and make or revoke the key. Routes: `GET /v1/admin/waitlist`, `PUT /v1/admin/waitlist/settings`, `POST`/`DELETE /v1/admin/waitlist/key`, `PUT /v1/admin/waitlist/:token` (edit; conditional on the row still being an entry, so it can't race an Invite), `POST /v1/admin/waitlist/:token/invite`, `DELETE /v1/admin/waitlist/:token`.
- **Invite:** creates a normal email invite that carries the entry's `profile`, sends the invite email, and deletes the entry. Resend keeps the profile.
- **Signup:** the form is prefilled from `GET /v1/auth/invite/:token`; values the person submits win. A stored group that has since been renamed or deleted is ignored rather than assigned.
- **Custom fields:** deleting a custom user field also erases its answers from wait-list entries and the invites made from them (`setInviteProfile`), and `GET /v1/admin/waitlist` only returns answers to fields that still exist.
- **No rate limit.** Like the rest of the public API, `POST /v1/waitlist` has none; an open list accepts any number of entries. The public form carries a **honeypot**: a hidden `website` input (off-screen, `aria-hidden`, out of the tab order). An unkeyed request that fills it gets the normal `202` and nothing is stored. Keyed requests skip the check, so an outside form may send any fields.

### Signup flow

`POST /v1/auth/signup` accepts `inviteToken`, `email`, `name`, `password`, `username` (optional), `userGroup` (optional), `customFields` (optional — see [Custom user fields](#custom-user-fields-364); format-validated, required-ness not enforced at signup).

- **Email invites:** `email` must match `invite.email`.
- **Link invites:** `email` can be any valid address (required field).
- **Wait-list invites:** `GET /v1/auth/invite/:token` returns the email, name, group, and field answers so the form starts filled in. Signup falls back to the invite's group and fields when the form leaves them out.
- All check TTL expiration, duplicate user, and username availability. On success, user is auto-logged in and invite is marked used (or usage count incremented for link invites).

Plugins can enrich lessons at start time by providing additional reference
material — e.g., WordPress docs, React API updates, internal knowledge bases.
Enrichment is computed **once** when the learner starts the lesson (after Lesson
Owner KB init, before Coach opens), cached on `lessonKB.enrichments`, and
injected into the coach's system context. The learner sees enrichments in the
"Additional Context" section of the lesson overview dialog (alongside exemplar
and objectives), where they can reference it throughout the lesson.

### Lifecycle

1. **Lesson start** — `client/src/lib/lessonEngine.js#startLesson()` calls
   `POST /v1/sync/lesson-started` (server route in `sync.js`)
2. **Hook emit** — server emits `lessonStarted` with `{ userId, lessonId, lesson: { name, markdown, exemplar, learningObjectives }, lessonKB }`
3. **Plugin handlers** — each plugin with `hook.lessonStarted` + `lessonEnrichment`
   capability runs; non-null return values are collected
4. **Return to client** — `{ enrichments: [...] }` returned to `startLesson()`
5. **Storage** — if enrichments exist, stored on `lessonKB.enrichments` and synced
6. **Coach context** — `buildContext()` injects enrichments into coach system prompt
   as `enrichmentContext: [{ source, context, reasoning }]`
7. **UI display** — `LessonChat` displays enrichments in the "Additional Context"
   section of the lesson overview dialog (opened via "Lesson Overview" button)
8. **Resume** — enrichments are read from cached `lessonKB` (never re-computed)

### Enrichment data contract

A plugin's `lessonStarted` hook handler returns:

```js
{
  pluginId: 'wordpress-info',       // Required: plugin id
  label: 'WordPress.org',            // Required: display name
  context: 'When building...',       // Required: ~300 word summary
  reasoning: 'This lesson focuses...', // Required: why this matters
  sources: [                         // Optional: citation links
    { url: 'https://...', title: '...', excerpt: '...' }
  ]
}
```

Return `null` (or omit return) when the plugin doesn't enrich this lesson. The
host filters out nulls — only non-null returns are stored.

### UI components

- **LessonLoadingView** (`client/src/components/chat/LessonLoadingView.jsx`) —
  stepped progress UI showing: (1) Initializing lesson (Lesson Owner), (2) Enriching
  lesson (plugins — only shown when active), (3) Starting conversation (Coach).
  The enrichment step expands to show per-plugin progress when multiple plugins
  are active. Includes `role="status"` and `aria-live="polite"` for screen reader
  announcements.
- **Lesson Overview Dialog** (`client/src/pages/LessonChat.jsx`) — modal dialog
  displaying lesson name, description, exemplar, learning objectives, and an
  "Additional Context" section showing enrichment data from plugins. Each enrichment
  is a semantic `<section>` with heading (`<h4>`), reasoning text, context paragraph,
  and source links in a `<nav>` with proper aria-labels and focus styles. The dialog
  content is scrollable (`max-h-[85vh]`) to handle long enrichments.

### WordPress Info plugin (reference implementation)

Three-agent pipeline (`plugins/wordpress-info/`):

1. **Planner** (`prompts/wordpress-info-planner.md`) — detects WordPress keywords
   in lesson objectives, outputs `{ shouldEnrich: bool, queries: [{ text, sources }] }`
2. **Query executor** (`server/query-executor.js`) — fetches from wordpress.org
   REST API, Make WordPress blogs, GitHub code search in parallel (8s timeout per
   source, fail-open on errors)
3. **Synthesizer** (`prompts/wordpress-info-synthesizer.md`) — distills query
   results into lesson-specific ~300 word summary: relevant APIs, best practices,
   common pitfalls

Hook handler (`server/index.js`) orchestrates the pipeline, returns enrichment
data or `null`. SSRF defense: all fetched URLs validated against `ALLOWED_HOSTS`
(`developer.wordpress.org`, `make.wordpress.org`, `api.github.com`).

### Design invariants

- **Fail-open, always.** Enrichment errors (planner fails, executor times out,
  synthesizer throws) must never block lesson start. Plugin handlers return `null`,
  the lesson proceeds normally.
- **Coach-owned completion.** Enrichment provides reference material the coach can
  draw on, but MUST NOT override completion semantics. `applyCoachResponseToKB`
  remains the single owner of `progress` and the exemplar. The enrichment context
  is framed as informational background, never as requirements.
- **One-shot computation.** Enrichment runs once at start, cached on `lessonKB`.
  Never re-runs on resume (learner sees same artifacts every time), never re-runs
  per chat turn (that would be the chat-context contributor pattern, not enrichment).
- **Timing budget.** Enrichment should complete in ~3-5 seconds to keep lesson
  start snappy. Plugins with slow sources should use timeouts, caching, or
  background jobs. The UI progress indicator keeps the learner informed.
- **Synthesis, not inlining.** Don't inline full documentation pages into the coach
  context — the synthesizer should distill to ~300 words of lesson-specific info.
  Sources are cited via links in the artifact panel.

### Why at start, not per-turn?

Enrichment is a **lesson-level** concern: "what background does the coach need
for *this lesson*?" Chat-context contributors (link attachments, image analysis)
are **turn-level**: "what context does the coach need for *this message*?"

Start-time enrichment:
- **Pro:** computed once, cached; no per-turn latency; learner sees what the coach
  has in mind from the beginning
- **Con:** can't adapt to learner questions mid-lesson (but the coach can still
  reference enrichment context when relevant)

Per-turn enrichment would:
- Add 1-3s latency to every coach reply (unacceptable for microlearning pacing)
- Bloat every turn's context with retrieval results (coach context is already dense)
- Force learners to wait through "Searching docs…" spinners repeatedly

The trade-off: enrichment is less dynamic but preserves the lesson's 20-minute
pacing target. If a learner asks a question the enrichment doesn't cover, the
coach still has the full lesson context + link attachments to draw on.

### Extension point for other plugins

Any plugin with `lessonEnrichment` capability + `lessonStarted` hook can provide
enrichment. Examples:
- **React Docs** — detect React keywords, fetch from react.dev
- **Internal KB** — query Confluence/Notion when lesson mentions company concepts
- **Recent updates** — pull latest bug reports, release notes, deprecations
- **Security policies** — inject org-specific code standards, compliance notes

The pattern is the same: detect relevance → fetch sources → synthesize summary →
return enrichment object or `null`.

### Known gaps & future work

- **Phase 1 agent calling** — plugins currently import `orchestrator.js` and call
  `converseStream` directly; Phase 3's `agent` capability will formalize prompt
  upsertion to sync-data and agent invocation via SDK
- **Structured output** — agents are instructed to return JSON, parsing happens in
  the hook handler; native structured-output tool would be cleaner
- **Hook return-value collection** — the hook system was extended to collect
  non-null returns; this pattern could extend to other hooks (e.g., `lessonCompleted`
  for summary generation)
- **Multi-lesson caching** — WordPress Info queries the same sources for every
  WordPress lesson; a shared cache (Redis or sync-data) could dedupe across lessons

## Lessons: visibility, drafts, courses, classroom

### Visibility

Lessons have three statuses:

- `public` — visible to all (legacy `published` normalizes to `public`).
- `private` — visible only to users in `sharedWith`.
- `draft` — in-progress, admin-only, no markdown yet.

A record is a **true draft** iff `status === 'draft'` AND markdown is empty;
legacy `status: 'draft'` records that *do* have markdown are treated as
`private` to preserve pre-rework semantics. Drafts surface as a `Draft` pill in
Admin → Lessons and are never exposed to learner-facing endpoints.

New lessons start as `draft` the moment the Lesson Creator conversation begins
(one `lesson:<id>` record per draft in `_system` sync-data), so admins can pause
and resume drafts or work on several in parallel. Clicking "Create Lesson"
finalizes the same record with extracted markdown and flips status
`draft` → `private` (shared only with author). Admins toggle public/private on
finalized lessons and manage shared users via the Share modal. Drafts hide the
Share icon (nothing shareable yet).

### Courses, units, and lessons (#408)

Lessons are organized as **Course → Unit → Lesson**. Every part is optional:
a lesson can sit outside any unit, and a unit outside any course. Everything
here is organization only. Lesson visibility (public/private/draft +
`sharedWith`) is unchanged, and nothing here affects completion.

**Storage keeps its pre-hierarchy names** (glossary: storage `course` = UI
**Unit**; storage `program` = UI **Course**). Nothing that references a unit
had to move: `lesson.course`, learners' `courseProgress:<unitId>` memory, and
stats.

| UI | Record | Membership | Order |
|---|---|---|---|
| Course | `_system:program:<id>` `{ name, description, unitIds }` | top level | by name |
| Unit | `_system:course:<id>` `{ name, programId, lessonIds }` | `unit.programId` | `program.unitIds` |
| Lesson | `_system:lesson:<id>` | `lesson.course` (the unit id) | `unit.lessonIds` |

`server/src/lib/hierarchy.js` is the single place that reads it:
- **Order arrays only order.** `orderIds()` lists the ids an array names that
  are still members, then any members it's missing by name (the
  pre-hierarchy behavior). A stale or missing array can't hide or duplicate
  anything; it falls back to alphabetical.
- Reorders must be an exact permutation of the members
  (`PUT /v1/admin/units/:id/order` and `/programs/:id/order`).
- `buildHierarchy()` gives positions. The learner reads (`GET /v1/lessons`
  and `/v1/lessons/:id`) inline `unit: { id, name, position, lessonPosition }`
  and `program: { id, name, position } | null`. They keep `course: { id, name }`
  (the unit) for one release, for cached clients.

Admin routes live in `server/src/routes/admin-hierarchy.js`:
- `/v1/admin/units*`, with `/v1/admin/courses*` kept as the deprecated alias.
- `/v1/admin/programs*`.
- Unit `PUT` **preserves fields it doesn't set**. The pre-hierarchy handler
  rebuilt the record and would have dropped `programId` and `lessonIds`.

**Cascades:**
- Deleting a unit sets `course: null` on its lessons (re-reading each and
  skipping any another admin already moved) and removes it from its course's
  order.
- Deleting a course leaves its units, unassigned.

**Admin UI:** Admin → Lessons → **Courses & Units**
(`/plato/lessons/structure`, `client/src/pages/admin/CourseStructure.jsx`)
replaced the old Courses modal.
- It adds, renames, and deletes courses and units, and puts a unit in a course.
- It orders units within a course and lessons within a unit with **Move up /
  Move down** buttons (no drag and drop). Each button names its item, and every
  move is announced in a polite live region. Focus is restored after the
  reloaded list renders. When an item reaches the top or bottom, focus moves
  to the opposite button, so the same item can keep moving.
- The lesson editor's picker is **Unit**, grouped by course (`<optgroup>`). The
  lessons table shows "Course › Unit".

**Migration:** `m004_default_program` puts every existing unit into one
default Course, named after the classroom, with the name-sorted lesson order
it already had, so nothing reorders on upgrade.

**Learner side:** `loadLessons()` carries `unit` and `program` onto each lesson
and returns them in hierarchy order. `client/src/lib/lessonOrder.js` holds the
pure helpers (tested in `client/tests/lessonOrder.test.js`):
- `compareLessons`/`sortLessons`: course position, unit position, lesson
  position, then name. Units outside a course come after courses; lessons
  outside a unit (including the learner's `custom-*` lessons) come last.
- `nextLessonAfter`: "Continue to Next Lesson" goes to the next lesson in the
  unit, then on into the next unit **of the same course**. It never jumps to
  another course. A unit outside any course stays within itself.
- `groupForDisplay` and `completionBy('program' | 'unit')` drive the lessons
  page (see [Learner classroom](#learner-classroom)).

**Coach context:** `buildContext` sends `unit: { name, progress? }` (the
cross-lesson note is per unit) and `course: { name }` (the course above it).
Before #408 the unit was sent as `course`. The `course-progress-update`
agent's input keys (`courseName`, `lessonsInCourse`) keep their old names; the
prompt says they describe the unit.

### Learner classroom

`/lessons` (`client/src/pages/LessonsList.jsx`): lessons render as a responsive
grid (1 col mobile / 2 col `sm:` / 3 col `lg:`) with 12 per page, in the
Course → Unit → Lesson order. A Course filter dropdown sits above the grid
(courses in their order, plus "Other lessons" for anything outside a course);
it's hidden when no courses exist. When the filter is set to a course that no
longer exists, it snaps back to "All courses" automatically. Card entrance
animations are `motion-safe:` only. Filter and page changes are announced via an always-mounted
`role="status" aria-live="polite"` region — no visible "N lessons" subhead.

Each course on the page gets an `h2` with an "N of M lessons" progress bar
(#395), and each unit an `h3` with its own "N of M" count. A unit outside any
course takes the `h2` level so headings never skip. The counts come from
`completionBy()` (`client/src/lib/lessonOrder.js`) over **all** of
the learner's lessons — never the filtered or paginated view, so a status
filter like "Not started" can't turn "5 of 8" into "0 of 3". The learner's own
`custom-*` lessons don't count. Purely informational; it reads
`lessonKB.status` and never affects completion.

`loadLessons()` merges system lessons (`/v1/lessons`) with user lessons from
sync-data. To preview a lesson as a learner sees it (the live coach experience),
admins share the lesson with themselves and view it in the classroom — the
editor preview only renders the lesson markdown.

### Lesson editor

Editing is conversation-based via the Lesson Creator agent (no raw markdown
editor). The editor is deep-linked at `/plato/lessons/:lessonId/edit` (mirrors
the `users/:userId` pattern) so it survives reload and browser-back.
`/plato/lessons/new` mints a fresh `admin-<ms>` draft id and `replace`-redirects
to that edit URL — the draft record is created lazily by the editor's first
auto-save. The edit route fetches the lesson on mount; a missing/deleted lesson
redirects to `/plato/lessons`, but a 404 on a freshly-minted draft id (within
`FRESH_DRAFT_WINDOW_MS`, i.e. not yet auto-saved) opens create mode instead of
bouncing. `AdminLessons` keys `NewLessonView` on `lessonId` so switching lessons
remounts cleanly.

**Markdown preview pane** (`client/src/pages/admin/MarkdownPreviewPane.jsx`):
chat left, rendered markdown right, stacking below `lg`. The preview is
**manually refreshed** via a "Generate preview" / "Refresh preview" button that
re-runs the relevant extractor agent — it does NOT auto-update per message and
runs no AI call on editor open. On open the pane shows the already-saved markdown
(edit) or a quiet empty-state (new). Once the conversation advances past the last
refresh a "Preview may be outdated" hint appears. The preview is **not
persisted** — a standing note tells the admin to click the save button.
`buildConversationText` (`client/src/lib/lessonCreationEngine.js`) is the shared
builder for the extractor input, used by both the finalize and preview-refresh
paths. The same pane (copy parametrized via props) backs both the lesson editor
(`extractLessonMarkdown`) and the **knowledge base editor**
(`AdminCustomizer` + `AdminKBSetup`, `extractKBMarkdown`).

### Coach directive

A lesson can carry **author-supplied runtime instructions for the coach** that
are neither exemplar nor objective — e.g. "reference the learner's portfolio
project throughout (don't ask what it is)," "if the learner picks tool X, share
this discount code + URL with these checkout caveats," or "assume the learner
already finished the intro lesson." These flow end-to-end through one optional
`## Coach Directive` markdown section:

1. **Extract** — `lesson-extractor` emits `## Coach Directive` **verbatim**
   (codes, URLs, caveats intact) only when the conversation contained such
   instructions; otherwise it omits the heading.
2. **Parse** — `parseLessonPrompt` (`client/js/lessonOwner.js`) reads the
   section into `lesson.coachDirective` (buffered like the exemplar so multi-line
   directives survive; absent ⇒ no key).
3. **Serve** — `buildContext` (`client/src/lib/lessonEngine.js`) surfaces it as
   `context.coachDirective` in **both** active and completed states.
4. **Obey** — `coach.md` treats it as a high-priority instruction followed every
   exchange. It refines *how* the coach runs the lesson; it never overrides the
   exemplar, assessment, or completion semantics (the coach still owns
   `progress`). The Lesson Creator (`lesson-creator.md`) is aware of directives
   and confirms them back to the admin rather than silently dropping them.

Historically this was a gap: the extractor's output format had no slot for
coach-facing instructions, so anything an admin typed beyond exemplar/objectives
(the Creator would echo it conversationally) was summarized away and never
reached the coach. Adding the field at all four layers closed the loop.

**Extraction contract — keep these in lockstep.** What an admin discusses in the
Lesson Creator conversation only persists if the Lesson Extractor has a field
for it. The set of persisted fields (name, description, exemplar, 2-4
objectives, optional coach directive) is the contract, and it's enforced by
prose in **five** places that must change together when a field is added or
removed: `lesson-extractor.md` (output format), `parseLessonPrompt`
(`client/js/lessonOwner.js`), `buildContext` (`client/src/lib/lessonEngine.js`),
`coach.md` (so the coach reads it), and — critically — `lesson-creator.md`'s
"What the lesson actually saves" section, so the Creator agent never promises an
admin something the extractor will silently drop. Adding a persisted lesson
field without updating the Creator's contract reintroduces exactly the
scrubbed-directive bug.

### Course progress (cross-lesson memory)

*Since #408 this memory is per **unit** (what the UI now calls a unit is stored
as a course). Keys, record shape, and the agent name are unchanged; read
"course" below as "unit".*

When a lesson belongs to a course, the coach gets a **tiny, distilled,
per-learner note of what that learner has demonstrated in the course's *other*
lessons**, so it can connect threads ("building on the prompt you wrote earlier
in the course…"). This is the learner-profile pattern scoped to a course — same
proven, bounded plumbing as `profileSummary`, not a new mechanism.

- **Store** — one `courseProgress:<courseId>` per learner (sync-data, key
  allowlisted in `server/src/routes/sync.js`):
  `{ courseId, summary, completedLessonIds[], updatedAt }`.
- **Regenerate** — on completion, the `if (achieved)` block in
  `lessonEngine.js` calls `updateCourseProgressOnCompletionInBackground`
  (`client/src/lib/courseProgressQueue.js`, a sequential queue mirroring
  `profileQueue.js`) **only when the lesson has a course**. The new
  `course-progress-update` agent (`client/prompts/course-progress-update.md`,
  `orchestrator.updateCourseProgress`) receives the *prior* summary + the *one*
  just-completed lesson's KB (+ the course's lesson list from
  `getLessonsInCourse`) and returns an updated summary with a **hard ~600-char
  cap**. This **incremental distillation** — never concatenating all sibling KBs
  — is what keeps both the agent's input and the injected note small.
- **Inject** — `buildContext` takes an optional 5th `courseProgress` arg and, when
  present, attaches it as `context.unit.progress` (`context.course.progress`
before #408). `startLesson`/`sendMessage`
  fetch it via `loadCourseProgressSummary` when the lesson opens (within a session
  the value only changes via *other* lessons' completions, so fetch-on-open is
  enough). `coach.md` documents `unit: { name, progress? }` as informational —
  it never touches the exemplar or completion (`applyCoachResponseToKB` stays the
  single owner of `progress`).

**Out-of-order completion just works**: complete B → `courseProgress:<id>`
regenerates → resume A → A's coach reads the now-current note including B. No
coupling between the lessons themselves.

*Known limitation (v1):* summaries build **forward** from completions after this
shipped; pre-existing completions are not backfilled.

### Getting Started, the bundled orientation lesson (#443)

One lesson ships with plato: **Getting Started** (`client/prompts/lessons/getting-started.md`,
fixed id `getting-started`). It teaches the classroom itself: the coach's
role, objectives and exemplars, sending and attaching work, completion,
navigation, and Settings → Chat. Its `## Coach Directive` lists the real
control names so the coach doesn't invent UI. The file travels with the
prompts (the deploy's `cp -r client/prompts` copies the `lessons/` folder),
and `seedDefaultContent` calls `ensureBundledLessons()`
(`server/src/lib/bundled-lessons.js`) on every cold start:

| Situation | What happens |
|---|---|
| First time on an install, classroom has no lessons | created **public** |
| First time on an existing classroom | created **private**; Admin → Lessons asks an admin to review and publish it |
| Admin deleted it | never recreated (`_system:bundled:<id>` marker remembers the install) |
| New version, copy unedited | updated in place; status, unit, and sharing kept; learner progress (`lessonKB:getting-started`) untouched |
| New version, copy edited | never overwritten; Admin → Lessons shows "has an update" with **View update / Apply update / Dismiss** |
| An admin's own lesson already uses the id | left alone (no `bundled` marker) |

The record carries `bundled: { id, version, dismissed?, publishNoticeDismissed? }`.
`version` is the hash of the canonical markdown the copy last synced to, and
the copy counts as edited when its markdown no longer hashes to it. The admin
lesson PUT keeps the marker, so editing makes a copy "edited" instead of
detaching it. Routes: `GET /v1/admin/bundled-lessons` (content.read) and
`POST /v1/admin/bundled-lessons/:id { action: 'apply' | 'dismiss' |
'dismiss-publish' }` (content.write; apply is audit-logged
`bundled_lesson_updated`).

Learners see it first: lesson reads include `startHere: true`, and the lessons
page puts it under a **Start here** heading above the courses. It isn't in any
course, so it doesn't count toward course progress. Learners can reopen it any
time; completion and progress persist like any lesson's.

**Keep it current:** a PR that changes learner-facing behavior updates this
lesson (see CLAUDE.md). Unedited copies everywhere pick up the change on the
next deploy.

### Your work: the lesson work view (#438)

A **"Your work"** button next to "Lesson Overview" (and on the lessons
page's outline dialog for started lessons, via `/lessons/:id?view=work`)
opens a read-only dialog (`client/src/components/chat/LessonWork.jsx`) with
three native `<details>` sections:
- **Progress:** the progress score and an objectives checklist.
- **Summary:** the exemplar, the coach's "where you are", and its notes, all
  read from the lesson KB. Nothing is generated for it.
- **Artifacts:** images and links the learner shared, from the messages'
  `metadata.imageKeys` / `metadata.links`. Images are fetched only when the
  section opens, each key once.

It works the same on completed lessons and in View as User (it only reads).

**The checklist.** The coach may add `"objectivesMet": [1, 3]` (1-based, as
the objectives are listed in its context) to `[KB_UPDATE]`.
`mergeObjectivesMet` (`client/src/lib/lessonWork.js`) folds it into
`lessonKB.objectivesMet` (0-based) **one way only**: a checked objective
stays checked. The coach's context includes `objectivesMet` so it doesn't
repeat itself. The merge runs before `applyCoachResponseToKB`, so the turn that
completes a lesson can still check off what it showed. It's informational:
completion is still the progress score alone, and a completed lesson shows
every objective as met. In real Qwen3-VL runs the coach reported met
objectives in 4 of 4 runs once the prompt's example included the field.

### Rewriting lessons in bulk (#261)

Editing in plato is conversation-based, and that's too slow for an editorial
pass over many lessons. Instead:
1. **Export** (read-only): `server/scripts/export-lessons.js <dir>` writes
   `<lessonId>.md` per lesson and a `manifest.json` with each lesson's hash
   and objective count (`server/src/lib/lesson-rewrite.js`).
2. **Edit and review** the `.md` files in a pull request (for prod lessons, in
   the private deploy repo).
3. **Apply**: `server/scripts/apply-lessons.js <dir>` is a dry run unless
   `--apply`. It refuses any lesson changed in plato since the export
   (`conflict`), any edit that fails the lesson checks
   (`server/src/lib/lesson-markdown.js`, shared with the admin lesson PUT), and
   any edit that changes the number of objectives. Each write is
   version-checked and logs a `lesson_rewrite_applied` audit entry with the
   before/after hashes. Status, unit, sharing, and learner progress stay.

Only the first line after the title is the lesson's description (what
`parseLessonPrompt` reads), so a rewrite puts "why this matters / how it follows
the last lesson" there. Coaching notes, such as terms to define at first use,
go in the optional `## Coach Directive`. No new lesson fields are needed.

### How assessment works (#257, #414)

`/how-assessment-works` (`client/src/pages/HowAssessmentWorks.jsx`) is a
public page, linked in the classroom footer and on the sign-in page, that
describes what plato actually does:
- each lesson's exemplar and 2–4 objectives
- the AI coach scoring progress 0–10 after every reply, and the model used
- what counts as evidence (text, screenshots, links, the learner's own reasons)
- completion at 10, with no message limit
- feedback-only after completion
- no AI-writing detectors
- the read-only, logged staff view

**Policy only people can set** is shown as "To be decided by the program
team" notes. Update the page when these are decided:
1. When learners may use AI tools to make the work they submit, and how they
   say so.
2. Whether people review completed lessons (spot-checks), and how a learner
   asks for a result to be reviewed (appeals).
3. What completing a course certifies, and each course's competencies, the
   evidence each needs, and their basis. This is deployment-specific, so it
   belongs in the classroom's own content (course and unit descriptions,
   lessons), not in plato's code.

The coach prompt backs this up (#414). When a response could have come from
anyone, the coach asks for a personal example or the learner's own
reasoning before awarding progress, **without accusing or speculating about
AI use**. It only checks off an objective when the evidence is in the
learner's own words or work. In real Qwen3-VL runs with a generic,
polished answer, it asked for the learner's own example in 6 of 6 runs, and
it stopped making accusatory remarks (1 of 3 runs before the change, 0 of 3
after). Genuine personal answers still scored 9–10.

## Pacing & completion philosophy

Microlearning constraints live in `client/src/lib/constants.js`:
`MAX_EXCHANGES=11`, `MIN_OBJECTIVES=2`, `MAX_OBJECTIVES=4`,
`MINS_PER_EXCHANGE=1.8`. Server mirrors them in
`server/src/lib/lesson-limits.js`. Prompts reference these as literal numbers
(update both if changed).

Lessons target 11 exchanges (~20 min). **There is no hard cutoff** — lessons
always run until the coach awards progress 10. The coach gets escalating
`pacingDirective` nudges in the context JSON (at 8+, 11+, 15+, 20+) but these
are suggestions, never orders. `client/src/lib/lessonEngine.js` must **never**
auto-complete a lesson based on exchange count; only `parsed.progress >= 10`
triggers completion. Philosophy: "move people, not force people" — the coach can
always introduce new scaffolding if the learner needs it. `extendedLessons`
(completions at 22+ exchanges) is informational only — it signals lesson-design
mismatch, not a metric to drive to zero.

### Post-completion feedback mode

Once `lessonKB.status === 'completed'`, the thread is feedback-only.

- `activitiesCompleted` freezes (it's the learning-exchange counter, not a
  total-turn counter — post-completion chatter doesn't count and would corrupt
  the `extendedLessons` KPI if it did).
- `pacingDirective` is suppressed and `postCompletionDirective` replaces it,
  telling the coach never to coach, assess, or award progress for a *different*
  lesson inside the same thread.
- **`progress` freezes too.** The directive above is prose inside a 167-line
  prompt, and compliance is model-dependent: evaluating open-weight Bedrock
  models for per-agent routing, Kimi K2.5 emitted `[PROGRESS: 10]` on every
  post-completion turn (when asked to start a *different* lesson in the thread)
  where Haiku 4.5 correctly emitted no progress tag at all. `achieved` was
  already safe via `!wasCompleted`, but the assignment to `next.progress` was
  not, so a completed lesson's score could be rewritten by any turn of feedback
  chatter. Completion semantics must not depend on a model choosing to obey an
  instruction — the freeze is now in code.
- `achieved` is one-shot — only true on the transition turn — so completion side
  effects (confetti, completion profile update) don't re-fire on subsequent
  feedback messages.
- KB updates (`insights`, `learnerPosition`) are **not** frozen — capturing
  feedback is the entire point of the post-completion thread.

Scores are also range-clamped to 0–10 via `clampProgress`, which returns `null`
(meaning "no score reported") for absent or unparseable values rather than
coercing them. `Number(null)` is `0` and `Number('ten')` is `NaN`, so a naive
coercion would silently reset a lesson's progress to zero when the coach omits
or malforms the tag — both caught by tests during implementation.

The pure helper `applyCoachResponseToKB` in `lessonEngine.js` is the **single
owner** of this invariant.

## Denormalization policy

plato's source of truth for learner activity is the `sync-data` table
(`lessonKB:*`, `messages:*`, etc.). When a read path requires aggregating across
many of those records — counts, "last X" timestamps, percentages — the right
move is to denormalize a derived field onto a record that's already cheap to
fetch (typically the user record), maintained by hooks on the sync write path.
The Admin → Users `lessonsCompleted` + `lastActiveAt` fields (#136) are the
canonical example. Do this **responsibly**:

- **Single writer.** Exactly one code path mutates each denormalized field —
  `server/src/routes/sync.js`'s `applyActivityEffects` for activity counters. No
  other route writes these fields directly. This is the only way to keep "two
  places" from drifting.
- **Transition detection for status counters.** The coach writes a `lessonKB`
  multiple times after completion (post-completion feedback turns keep updating
  it). Counters that fire on status flips must read the prior record and only
  increment on the first transition (non-completed → completed). Repeat writes
  with the same status MUST NOT double-count. `lessonsCompleted` has a dedicated
  test for this; new counters must too.
- **Published-only stats.** Every dashboard/per-user KPI counts **only published
  (public) lessons** — drafts, privates (even when shared to a learner via
  `sharedWith`), and user-created custom lessons are excluded from both the
  numerator and the denominator. The rule lives in
  `server/src/lib/lesson-visibility.js` (`normalizeStatus`, `publicLessonIds`,
  `isPublicLessonRecord`); a completion counts iff its lesson id maps to a public
  `_system:lesson:*` record. Custom lessons (stored under the learner's own
  `lessons:custom-*` sync-data, never in `_system`) fall out for free. The
  `applyActivityEffects` writer looks up the lesson record before incrementing.
- **Best-effort writes, never blocking.** The primary sync write succeeds first.
  The counter update is wrapped in try/catch and logged but never thrown. If it
  fails, the user's lesson data is still correct — only the counter is stale, and
  lazy-backfill heals it on next admin read.
- **Lazy backfill instead of migrations.** When the read endpoint encounters a
  record with an undefined counter (legacy user), it computes the value once and
  persists it back. After that, reads are O(1). No deploy-time migration step.
- **Source of truth is still the underlying data.** Counters are an index, not
  authoritative. On drift, the underlying sync-data wins; a manual rebuild script
  can re-derive counters from scratch.
- **Anti-goals.** Don't denormalize fields that change on every learner message
  (write amplification — message-rate is plato's hot path). Don't make the
  primary write fail if the denormalized write fails. Don't add a second write
  path for the same field. Don't denormalize values that depend on cross-user
  state (e.g. a user's "rank in the classroom") — compute those per-request from
  cheap classroom-wide lists.

### Per-user activity stats (#136)

Admins see a learner's lesson activity on the Admin → Users edit-user view,
deep-linked at `/plato/users/:userId` so refresh and browser-back preserve the
selection. The edit-user state is derived from the URL via `useParams`;
`openEditUser` navigates rather than setting state directly. A bad userId
silently redirects back to `/plato/users`.

`UserStatsPanel` (`client/src/pages/admin/UserStatsPanel.jsx`) fetches
`GET /v1/admin/users/:userId/stats` and renders three summary tiles (a
CompletionRing for completed/available with color thresholds at 35%/90%,
logins-in-window count, median completion time with p90 sub) and a list of
completed lessons. Computed on demand — no precomputation.

- UI uses "completed" / "completion time" rather than "mastered" / "time to
  mastery" because the underlying field is `lessonKB.status === 'completed'` —
  calling it mastery would imply a quality claim we don't measure.
- Duration is exchange-based (`activitiesCompleted × MINS_PER_EXCHANGE`) for
  consistency with `/v1/admin/stats/lessons` — wall-clock minutes inflate from
  multi-session lessons.
- Logins come from audit-log `user_login` entries (written by `/v1/auth/login`;
  the audit-log table has no GSI on userId, so reads use Scan-with-filter — fine
  at current scale, revisit at ~100k entries).

The Admin → Users table opt-in `?include=stats` adds `lessonsCompleted`,
`lessonsAvailable`, and `lastActiveAt` to each row; the Completed column renders
a compact CompletionRing colored by progress.

- `lessonsCompleted` (published-only) is **recomputed per request** from the
  learner's sync-data against the live public-lesson set, and the denormalized
  counter is healed (overwritten) when it drifts. The `applyActivityEffects`
  hook keeps the stored counter close in the meantime, but it can't be trusted
  on its own for visibility — a lesson can go public→private *after* a learner
  completes it, and legacy/pre-filter counters may be inflated. Recomputing on
  read is the deliberate trade (chosen over a one-time migration): it loosens
  the strict O(1)-per-user goal for a small per-user read, which self-corrects
  prod's existing counters. To keep that cheap at hundreds of users, the read
  uses `db.getSyncDataByPrefix(userId, 'lessonKB:')` — a **sort-key prefix
  query** that returns only the `lessonKB:*` records (tens of tiny items),
  never the large `screenshot:*`/`messages:*` payloads. `getAllSyncData`
  (full-partition, unprojected) must NOT be used in per-user loops over the
  whole classroom for this reason.
- `lastActiveAt` is **not** updated on `messages:*` writes (write amplification —
  see anti-goals); instead it's updated on `/v1/auth/login` and `/v1/auth/refresh`,
  giving a natural ~15-min heartbeat (access-token TTL). It stays a true
  denormalized read (lazily backfilled, not recomputed).
- All activity writes are best-effort (try/catch, swallowed). The lessonKB
  pre-read (used to detect the transition) and the `_system:lesson:*` visibility
  lookup are wrapped in try/catch — a failure just defaults to no increment, and
  the next stats read heals it; the lesson write never fails.
- `lessonsAvailable` is the count of **public** lessons (`publicLessonIds(...)`),
  computed per-request from the small classroom-wide lesson list — the same
  denominator for every learner.
- Columns are sortable (click header to cycle asc/desc with aria-sort + a polite
  live region); nullish values always sort last regardless of direction so
  invites cluster predictably. Modals/dropdowns that don't need stats call the
  base endpoint to skip the lessons-available computation.

`CompletionRing` (`client/src/pages/admin/CompletionRing.jsx`) is an SVG donut
showing completed / available lessons, color-coded (red <35%, yellow 35–89%,
green ≥90%).

### Admin dashboard KPIs

Admin dashboard at `/plato` (lazy-loaded, role-gated) has two KPI sections:

- **Learner Engagement** — `Started lessons %` (target ≥90%) and
  `Completed 50%+ of lessons %` (target >50%). Denominator is non-admin users;
  "started" = ≥1 `lessonKB:*` record for a **public** lesson (any status);
  "completed 50%+" = `lessonsCompleted / lessonsAvailable > 0.5` (strict — exactly
  50% does not count), where both sides are published-only. Each widget renders
  green on target, red below.
- **Lesson Pacing** — on-target rate, over-target count, extended-lesson count.

Both are powered by `GET /v1/admin/stats/lessons`, which is **stale-while-
revalidate cached** in `_system:stats:lessons` sync-data (see
`server/src/lib/lesson-stats-cache.js`). Fresh window: 10 min. Stale window
(10 min–24 h): cached payload served and an async Lambda self-invoke kicks off a
refresh (`InvocationType: 'Event'`, see the wrapped handler in
`server/src/index.js`). Expired (>24 h) or missing: recompute synchronously. The
recompute walks every user's `lessonKB:*` + `messages:*` records (via
`getSyncDataByPrefix`, skipping the large `screenshot:*` payloads), so it should
never be on the hot path of an admin page load. `lambda:InvokeFunction`
scoped to `${StackName}-*` is granted to `PlatoApiFunction` in `template.yaml`.
In local dev / tests, `AWS_LAMBDA_FUNCTION_NAME` is unset and the kickoff is a
no-op.

## Custom user fields (#364)

Admins define extra profile fields (Admin → Users → **User Fields**) that every
user fills in — e.g. organization, role, website, phone. Built for the waitlist
(#363), whose registration form collects the same fields, and so admins can
search/filter users by them instead of keeping side spreadsheets. It's core,
not a plugin: it touches signup, the classroom gate, `/settings`, and the
Users list, none of which have plugin slots, and #363 depends on it.

**Storage.**
- Definitions: ordered array at `_system:settings.userFields`, alongside
  `userGroups`. Shape: `{ id: 'fld_…', label, type, required, options? }`.
  Types: `text`, `textarea`, `dropdown` (with `options`), `link` (http/https
  only), `phone` (7–15 digits).
- Values: on the **user record** as `customFields: { [fieldId]: string }` —
  not sync-data, so the Users list can search/filter every user without N
  extra reads. SQLite stores it as a JSON `TEXT` column, (de)serialized at the
  db boundary (`rowToUser`); DynamoDB stores a native map.
- `server/src/lib/user-fields.js` is the single validator
  (`validateFieldDefinition`, `mergeFieldValues`, `missingRequiredFields`,
  `visibleFieldValues`). Values are keyed by stable id, so relabeling a field
  never orphans answers. A field's **type can be changed** (`PUT
  /v1/admin/user-fields/:id` with `type`), keeping its id and answers. If
  the new type — or a dropdown losing options — would leave stored answers
  (users + wait-list/invite profiles) that fail the new rules, the server
  replies `409 { invalidCount }` and the dialog confirms before resending with
  `confirmInvalid: true`. Those answers are kept as-is; every later save
  through any route re-validates, so they get fixed the next time they're
  edited. (Delete + re-add would erase every answer and mint a new id,
  breaking integrations that map to it.)
  Deleting a field erases its values from every user, and from wait-list
  entries and invites carrying a profile (same cascade as deleting
  a user group). Values for ids with no current definition are never returned.

**API.**

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `GET /v1/user-fields` | public | Definitions only (for the signup form) |
| `GET /v1/me/fields` | user | `{ userFields, values, missing }` |
| `PATCH /v1/me` `{ customFields }` | user | Partial merge; result must have every required field → else 400 |
| `GET/POST /v1/admin/user-fields` | admin | List / add (`{ userFields }` response) |
| `PUT /v1/admin/user-fields/:id` | admin | Edit label / required / options / type (`409 { invalidCount }` unless `confirmInvalid`) |
| `PUT /v1/admin/user-fields/order` | admin | Reorder (`{ ids }`, must be a permutation) |
| `DELETE /v1/admin/user-fields/:id` | admin | Remove + erase values |
| `PATCH /v1/admin/users/:id` `{ customFields }` | admin | Edit values; same required rule as `/v1/me` |

`GET /v1/admin/users[/:id]` and `GET /v1/me` include `customFields`;
`GET /v1/me/export` includes them with labels.

**Required fields & the gate.** `ProfileCompletionGate` wraps the classroom
routes (not `/plato/*`) and fetches `GET /v1/me/fields` on every classroom load
— the cached auth user in localStorage can't know an admin just made a field
required. If anything required is missing, the learner sees "Update your
profile" with just those fields and can't reach lessons until they're saved. A
dropdown value that's no longer one of the options counts as missing, so
learners re-pick after an admin edits the list. Deliberate choices:
- **Fails open** — if the status request errors, the classroom renders; a
  profile prompt must never lock learners out of lessons.
- **Client-side gate only** — the API doesn't refuse lesson calls for
  incomplete profiles. It's a data-collection prompt, not an access control.
- **Signup doesn't enforce required server-side** (the form does client-side):
  a stale cached signup form must not hard-fail account creation; the gate
  catches anything missing on first visit.
- **Admin edits enforce required fields too** (Edit User form + server): a
  save with `customFields` is refused until every required field is filled.
  Consequence: after adding a required field, an admin must fill it in to
  save any Edit User change for a user who hasn't answered yet. (Edits that
  omit `customFields` are unaffected.) The gate is skipped during "View as
  User".
- Required fields show a visible "(required)" label marker (aria-hidden;
  `aria-required` carries it for screen readers).

**Admin → Users.** Search matches custom field values too. A field filter
(field + Has a value / Empty / a specific dropdown option) narrows the list
and adds a column with that field's values. **Download CSV** (#382) exports
the list as shown (current filter, search, and sort) with one column per
custom field (`client/src/lib/csv.js`). Cells that start with `= + - @` or a
tab/CR get a leading `'` so spreadsheets treat them as text: names and
answers arrive from the public wait-list form, so a formula there would be
attacker-controlled (CSV injection). Dates are ISO; the file has a UTF-8 BOM
and CRLF line endings so Excel opens it cleanly.

## Admin tables: filters, columns, User ID (#362, #385, #386)

**Filters (Admin → Users).** A Filters menu (`client/src/pages/admin/FiltersMenu.jsx`,
logic in `client/src/lib/userFilters.js`) replaced the single-choice
All / Active / Staff / Invited / Wait List buttons and the one custom-field
filter.
- It has one group of checkbox items per facet: Status (Signed up, Invited,
  Wait list), Role, Group (plus No group), and every custom field (its
  dropdown options plus Empty, or Has a value / Empty). Each option shows its
  count.
- Filters combine as **OR within a facet, AND across facets**. Each facet has
  Select all and Clear.
- Facets that don't apply drop an item: a role filter leaves out invites and
  wait-list entries, and invites have no field answers.
- Active filters show as removable chips with a "Clear all" button, and a
  polite status line says "N of M people".
- Search also matches the User ID.

**Columns (Users and Lessons).** A Columns dialog (`ColumnsDialog.jsx`,
logic in `client/src/lib/tableColumns.js`) shows and hides columns and moves
them with Move up / Move down buttons. Focus stays on the moved row, and each
change is announced.
- The layout is saved per browser in localStorage
  (`plato:columns:users:v1`, `plato:columns:lessons:v1`) and reconciled with
  the current columns: new ones appear in their default place, and removed
  ones drop.
- The name/open column and the actions column are fixed.
- Every custom field is a Users column, hidden until chosen. This replaced the
  old filter-driven extra column.
- Lessons adds a hidden Lesson ID column.
- Column resizing isn't built.

**User ID (#386).** The immutable account id (`usr_…`) is a Users column
(sortable and searchable) and the last CSV column, as a stable key for
research and reporting. Admin contexts only; learners never see it.

## User groups (#434)

Group names live in `_system:settings.userGroups`. Membership is the name on
each user (`userGroup`), on wait-list entries and invites (`profile.userGroup`),
and on messages sent to a group (`audience.group`). `server/src/lib/groups.js`
owns them:
- Names are 1–80 characters and **unique ignoring case**. The list is stored
  sorted A–Z, with "None" and "Other" last; `GET /v1/groups` sorts older lists
  on read.
- **Rename** (`PUT /v1/admin/groups { oldName, name }`) writes the group list
  first, version-checked. Then it moves every membership: users, wait-list
  entries, pending invites, and group messages, so the bell keeps showing them
  to the group. It returns `moved: { users, invites, messages, failed }` and
  writes a `group_renamed` audit entry. A failed membership write is retried by
  renaming again.
- **Delete** clears the group from users and invites. Messages already sent
  keep their audience.

The User Groups dialog (`client/src/pages/admin/GroupsDialog.jsx`) has inline
rename (Enter saves, Escape cancels), member counts, and a delete
confirmation. Errors show inside the dialog. Its parent refreshes quietly, so
the page spinner doesn't unmount it.

## Roles & permissions (#435)

Four roles. `server/src/lib/permissions.js` is the single source of who may do what.

| Role | Can |
|---|---|
| **admin** | everything |
| **educator** | lessons, courses, and units (read/write); view users and progress; invite learners; invite from the wait list. **Not:** Customizer (theme, knowledge base), prompts, settings writes, plugins, custom fields, groups, user edits/deletion, roles, logs, View as User |
| **learner** | the classroom only. Stored as `user` before #435; `normalizeRole()` maps legacy and unknown values to `learner` |
| **tester** | every `*.read` permission, so they see all classroom and admin pages, plus View as User; **no writes** to admin routes. They can still take lessons, since their own `/v1/sync` and `/v1/me` writes aren't admin routes |

**Enforcement:** `/v1/admin/*` runs `authenticate`, then `authorize`
(`server/src/middleware/authorize.js`).
- `authenticate` reloads the user's role from the DB on every request, so a
  role change applies immediately.
- `authorize` looks the request up in `ROUTE_PERMISSIONS`. **Any route not in
  the table is admin-only**, so a new route is safe by default.
- `tests/lib/permissions.test.js` fails if a registered admin route is unmapped
  or a table row is stale. `tests/routes/admin-authorization.test.js` drives
  the real admin app as each role.
- A refusal returns `403 { code: 'forbidden', permission }`.
- Plugin admin routes still use the SDK's `requireAdmin` (admin only).
- View as User reads (`?asUserId=`, in `sync.js` and `content.js`) need
  `impersonation.use` (admins and testers).

**Data and API.**
- The role endpoint (`PUT /v1/admin/users/:id/role`, admin only) accepts the
  four roles, with legacy `user` read as learner. It refuses an admin's own
  role, and refuses demoting the last admin. Every change writes an audit
  entry `role_changed { from, to }`.
- New signups are stored as `learner`. Migration `m003_role_learner` renames
  stored `user` to `learner` conditionally, leaving `updatedAt` alone.
- Every API response sends the normalized role. Stats count only
  `role === 'learner'` as learners.
- The plugin hook payloads (`userCreated` / `userDeleted`) carry the
  normalized role (plugin API 1.4.0).

**Client.**
- `client/src/lib/permissions.js` mirrors the map, and a test compares it with
  the server's.
- `can(user, permission)` drives:
  - the `/plato` route gate (`admin.access`) and per-page gates
    (`RequirePermission`: Customizer and KB setup need `kb.read`, Plugins
    needs `plugins.read`)
  - the admin nav
  - the classroom admin bar
  - which controls render
- Rule: a control shows if the role can use it, **or the user is a tester**.
  Testers explore every screen, and `adminApi` refuses their writes up front
  with "Testers can look around but can't save changes". Educators don't see
  controls they can't use; Edit User is read-only for them.
- AdminLayout shows testers a read-only notice.
- `AuthContext` re-reads `/v1/me` on load (`refreshCurrentUser`), so a role
  change applies on the next page load, not just the next login.

## First and last names (#402)

Users have `firstName` and `lastName`. `name` stays on the record, always
derived as `firstName lastName`, for plugins, the audit log, emails, and
Beta-RC-232 rollback. `server/src/lib/names.js` is the single reader and
writer:
- `readNameInput(body, { current, required })` reads a request. `firstName` /
  `lastName` win; a lone `name` (older clients, the public wait-list API) is
  split. A part the body leaves out keeps its current value. A first name is
  required; a last name is optional (people with one name exist). Each part is
  at most 100 characters.
- `nameFields(record)` is what every response sends: `name`, `firstName`,
  `lastName`, `nameSource`. A record without parts (written before #402, or
  not yet reached by the migration) is split on read.
- **`nameSource`** is `'user'` when a person or admin entered the parts, and
  `'auto'` when they were inferred. The UI hints that an `'auto'` split may
  need a correction. Nothing is silently discarded: the inference splits at the
  first whitespace and everything after it becomes the last name.

Routes that take a name: setup, signup, `PATCH /v1/me`,
`PATCH /v1/admin/users/:id`, and the wait list (join and admin edit; profiles
store the same fields). `GET /v1/auth/invite/:token` returns the parts so
signup can fill them in.

**Migration:** `m005_name_split` writes the inferred parts with
`setUserNameSplitIf` (conditional on `name` unchanged and no parts yet;
`updatedAt` untouched). Empty names are left alone. The dry run reports how
many names had 3+ parts. Wait-list entries aren't migrated; they're split on
read and replaced when the person signs up.

**`preferences.name` is retired.** Settings edits the name on the account
(`PATCH /v1/me`), and the sync route no longer copies `preferences.name` to
the user record, so an old value left in preferences can't undo a corrected
split. The coach's `learnerName` is the account's `firstName` (it used to be
`preferences.name`, which stayed blank until the learner saved Settings).

**Client:** `client/src/components/NameFields.jsx` renders First name / Last
name (optional) with `given-name` / `family-name` autocomplete, and the
"Split automatically…" hint (tied to both inputs by `aria-describedby`) when
`nameSource` is `'auto'`. It's used on signup, setup, the wait list, Settings,
Edit User, and Edit Wait List Entry. The Users list sorts by last name, and
the CSV has First Name and Last Name columns.

## Notifications (#388, #389, #400)

Everything plato emails on its own (automations) or on an admin's behalf
(messages) goes through `server/src/lib/notifications.js`. Invite and
password-reset emails stay in `email.js`.

- **Automations** live in `_system:automations` = `{ waitlistConfirmation,
  inactivityNudge, weeklyDigest }`. Every one is **off** until an admin turns it
  on, including on an upgraded install.
- **Templates** come with a default copy in code (`TEMPLATES`); an admin's
  version is stored in `_system:emailTemplate:<id>` (`{ subject, body }`) and
  can be reset back to the default.
  - A body is plain text: paragraphs separated by blank lines, `{{variables}}`
    from that template's list, and a line holding only `{{link}}` becomes a
    button.
  - Saving refuses unknown variables, a multi-line subject, or anything over
    200 characters (subject) or 5000 (body).
  - Values are HTML-escaped in the HTML part.
- **Sending** is multipart text + HTML, as raw MIME through SES
  (`SendRawEmail`), so we can add `List-Unsubscribe` and one-click
  `List-Unsubscribe-Post` (RFC 8058). Header values are forced onto one line.
  - `SKIP_EMAIL=true` logs instead of sending.
  - `EMAIL_ALLOWLIST` (the `EmailAllowlist` stack parameter) limits recipients.
    When it's empty: anyone on prod, no one on other stages.
- **Unsubscribe** uses tokens that are HMAC-signed per user and kind (`nudge`,
  `digest`, `messages`; the key is derived from `JWT_SECRET`).
  - `GET /v1/unsubscribe?token=` shows a confirm button, so link scanners can't
    unsubscribe anyone. `POST` (the button, or a mail client's one-click
    request) records the opt-out.
  - Opt-outs and per-user bookkeeping live in the server-only `notify:state`
    sync record, which learners can't write through `/v1/sync` and which a
    progress reset keeps. Learners manage them through
    `GET/PUT /v1/me/notifications`.
- **Wait list confirmation (#388):** sent by `POST /v1/waitlist` only when
  *that request* created the entry. The create-only insert means a retry or a
  duplicate join (which finds the entry) never sends again. A failure logs
  `waitlist_confirmation_failed` and never fails the join. It's one-time mail,
  so it carries no unsubscribe link.
- **Messages (#389):** Admin → Notifications → Compose sends a one-off
  message to everyone, a group, or specific people, in the classroom and/or
  by email (`server/src/lib/messages.js`).
  - The record is `_system:message:<id>`.
  - "Everyone" and a group mean **learners**, and only learners who had joined
    when it was sent. Specific people can be anyone.
  - In-app delivery is worked out when the learner reads (`GET /v1/me/messages`),
    so nothing is written per recipient. Read state is `notify:state.read`
    (`POST /v1/me/messages/read`). `important` messages also open as a pop-up.
  - Email goes out in the `send-message` background job, five at a time,
    honoring the `messages` opt-out with an unsubscribe link. It records
    `counts` (emailed, opted out, not allowlisted, failed), and a re-run of a
    finished job sends nothing.
  - Lambda retries an async job that failed or timed out, so each recipient is
    **claimed** in their `notify:state.emailed[messageId]` before the send,
    and a retry skips them. An SES error releases the claim, so the retry
    tries that person again. A run killed mid-send keeps its claims (at most
    once, never twice).
  - Compose shows the audience size first (`POST …/preview`) and asks for
    confirmation.
  - Each send writes a `message_sent` audit entry.
- **Background jobs** (`server/src/lib/jobs.js`): `dispatchJob(name, payload)`
  asynchronously invokes the **API function**, whose handler routes
  `{ __platoInternal: 'platoJob' }` events to `runJob`. Locally the job runs
  in-process.
  - The stream function, which serves all CloudFront traffic, can't take
    non-HTTP events. So it finds the API function in `JOBS_FUNCTION`. The API
    function's timeout is 300 s, for jobs; HTTP stays capped at 29 s by API
    Gateway.
  - The dashboard's async stats refresh used to invoke the stream function
    itself and never ran: prod logged 51 invokes and 0 completions in 14 days,
    and the API function had no log group at all. It now uses the same target.
- **Scheduled learner emails (#400)** live in `server/src/lib/learner-emails.js`
  and run as background jobs. Each does nothing while its automation is off.
  - **When they run:** no EventBridge rule. Creating one needs `events:*` on
    the deploy role, which the role in `docs/DEPLOY.md` doesn't have, and
    playground's deploy failed on exactly that. Instead, at most every 10
    minutes per container, a request checks `_system:jobs:schedule`
    (`server/src/lib/schedule.js`). A job that's due and on is claimed with a
    version-checked write (one container wins) and dispatched. The reminder
    is daily from 15:00 UTC, and the digest Mondays from 15:00 UTC. A day
    with no traffic sends nothing.
  - `inactivity-nudge` (daily, 15:00 UTC): a learner whose started lesson has
    gone 7 days untouched (its `lessonKB` record's `updatedAt`) gets one
    reminder, for the most recently active such lesson. The same lesson isn't
    nudged again for 14 days, and a learner gets at most one a day.
  - `weekly-digest` (Mondays, 15:00 UTC): lessons completed this week,
    lessons in progress, and lessons **published** this week (`publishedAt`,
    set by the admin lesson PUT the first time a lesson goes public). Skipped
    when there's nothing to say, and at most once every 6 days.
  - Both cover learners only and only lessons the learner can see, honor
    `optOut.nudge` / `optOut.digest`, and write their bookkeeping
    (`nudges`, `lastNudgeAt`, `lastDigestAt` in `notify:state`) before
    sending, so a retried run never emails twice.
  - Run one by hand with `aws lambda invoke --function-name <PlatoApiFunction>
    --invocation-type Event --payload
    '{"__platoInternal":"platoJob","job":"inactivity-nudge"}'`.
- **Admin routes** (`server/src/routes/admin-notifications.js`) need
  `notifications.read` (admins, testers) or `notifications.write` (admins):
  - `GET /v1/admin/notifications`
  - `PUT …/automations`
  - `PUT` and `DELETE …/templates/:id`
  - `POST …/templates/:id/test`, which sends the saved or unsaved draft to the
    signed-in admin with sample values
  - `POST …/preview`, `GET …/messages`, and `POST …/messages`
- **Learner UI:** a **bell** in the classroom header (`client/src/components/NotificationsBell.jsx`;
  hidden in View as User) lists messages, newest first, with an unread
  count in its accessible name. Opening it marks what it shows as read.
  An unread `important` message opens once as a dialog ("Got it" marks it
  read). It re-checks when the tab comes back into view, with no polling. The bell
  and the account menu are **non-modal** Radix menus, because a modal one
  `aria-hidden`s the whole page while open (axe `aria-hidden-focus`).
  Settings → **Email** has checkboxes for reminders, the weekly digest, and
  classroom messages, saved on change.
- **Admin UI:** Admin → **Notifications** (`client/src/pages/admin/AdminNotifications.jsx`)
  has three tabs. Compose: audience radios, a searchable people picker, the
  channels, the subject and message, the audience count, and a confirm dialog.
  Automations: each automation's on/off toggle and its email editor, with
  save, a test send to yourself, and reset to default. History: sent messages
  with delivery counts. Testers can see everything and send nothing.

## Admin "View as User"

Admins can audit a learner's classroom (lesson list, conversation history,
lesson KB) without asking for screenshots. Triggered from a "View as user"
button in the purple admin bar in the classroom (`AppShell`); a yellow status
strip with an "Exit" button surfaces underneath while impersonation is active.

- Read-only `?asUserId=<id>` query param threaded onto GET `/v1/sync*` and GET
  `/v1/lessons*` from `client/js/auth.js`'s `authenticatedFetch`; admin-gated
  server-side.
- **Read-only on the server for every route.** While a session is active,
  `authenticatedFetch` sends `X-Plato-View-As: <targetUserId>` on *every*
  request, and the global `viewAsReadOnly` middleware
  (`server/src/middleware/viewAsReadOnly.js`, mounted before all routes in
  `index.js` and `dev-sqlite.js`) rejects any non-GET carrying it with
  `403 { code: 'view_as_read_only' }`. The only exceptions are leaving the
  session (`POST /v1/admin/impersonation/end`), token refresh, and logout.
  Writes never carry `?asUserId=`, so the older per-route check in `sync.js`
  never fired on its own; before the header, a stray write mid-session would
  have landed on the *admin's* own records. On top of that,
  `client/src/lib/lessonEngine.js`'s `startLesson`/`sendMessage` throw at the
  top to back up the disabled `ComposeBar`. A normal browsing session makes
  no writes (verified across lessons, a lesson with history, and Settings).
- Impersonation state lives in `sessionStorage('plato_impersonation')` (per-tab)
  and `AuthContext`. `startImpersonation` / `stopImpersonation` clear the storage
  cache *and* hard-reload to `/lessons` — clearing the cache alone wasn't enough
  because `AppContext` (lesson list, per-lesson progress badges) holds component
  state that wouldn't otherwise re-fetch. For an audit feature, "no stale data"
  beats a faster transition.
- Audit-logged at session granularity (`admin_view_as_user_started` / `_ended`)
  — per-read entries would spam the log. POST `/v1/admin/impersonation/start`
  `{ targetUserId }` writes the start entry and returns the target profile for
  the banner; POST `/v1/admin/impersonation/end` is best-effort (no-op if the
  admin closes the tab — the start entry is the source of truth).
