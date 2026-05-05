# OpenRouter Rewards Plugin — Design

**Status:** Design (pre-implementation)
**Date:** 2026-05-05
**Author:** brainstormed with Henry Perkins
**Repo:** plato

## Summary

A new plato plugin (`plugins/openrouter-rewards/`) that issues OpenRouter API keys to learners as configurable lesson-completion rewards. Admin defines a rule list ("after N lessons" or "specific lesson"); when a learner satisfies a rule, plato walks them through a one-screen OpenRouter signup, adds them to the classroom's OpenRouter workspace, and mints a workspace-scoped key with a USD limit. The plaintext is shown in plato once and DM'd via the existing Slack plugin.

The design satisfies the original ask in full:
- Provision keys after completing X lessons OR after a specific lesson — rule list with `lesson-count` and `specific-lesson` triggers.
- Quick signup/authorization to join the classroom's OpenRouter team — OAuth PKCE flow that creates the OpenRouter user (if needed) and adds them to the configured workspace.
- Key displayed in plato — one-time reveal modal in the plato SPA.
- DM the learner's Slack — emitted as a plugin event the existing Slack plugin subscribes to.

## Non-goals

- Funding the learner's *personal* OpenRouter account. OpenRouter has no public credit-transfer API; classroom credits stay in the classroom workspace and the learner uses keys minted into that workspace.
- Storing the plaintext key at rest in plato. It only exists in the body of a single HTTP response and in transient in-memory state during the mint call.
- Per-learner toggles for delivery channels. Slack DM happens automatically when the Slack plugin is enabled and the learner's plato email matches a Slack user. No opt-out, no opt-in.
- Replacing or augmenting the lesson completion decision. `applyCoachResponseToKB` remains the single owner of "is this lesson done"; this plugin only observes the completion outcome.

## User-facing flows

### Admin: configure rewards

1. Admin opens `/plato/plugins`, enables OpenRouter Rewards, expands the settings panel.
2. Admin pastes their OpenRouter management/provisioning key (writeOnly field).
3. Admin enters their OpenRouter workspace ID (the classroom's workspace where learners will be added).
4. Admin clicks "Test connection" — plato server calls `GET /api/v1/keys?limit=1`; OK or surfaced error.
5. Admin adds rules. Each rule: name, trigger (`lesson-count` | `specific-lesson`), value (count or lesson id, picker for the latter), credit amount (USD), limit reset cadence (`daily` | `weekly` | `monthly` | none), expires-after-days (optional).
6. Admin sets reissue cooldown (default 24h).
7. Save.

### Admin: per-learner view

`AdminProfileFields` slot in the existing admin user-edit page shows, when the plugin is enabled:
- Connected OpenRouter user id (truncated) + connection status.
- Current key hash (truncated) + lifetime awarded + rules fired count.
- Live link "View on OpenRouter" → `https://openrouter.ai/settings/keys` (opens in new tab; admin sees the key in their OpenRouter dashboard).
- Buttons: Revoke, Force reissue.

### Learner: earn → claim → use

```
[Lesson completes — coach awards progress 10 — applyCoachResponseToKB sets status=completed]
  └─ LessonChat.jsx renders existing celebration
  └─ <PluginSlot name="learnerCompletionAfter"> mounts
       └─ Plugin component calls POST /v1/plugins/openrouter-rewards/check-pending
            (sends { lessonId } so the server can rule-evaluate against the just-completed lesson)
       └─ Server response is one of:
            { status: 'no-claim' }
            { status: 'minted', plaintext, lifetimeAwarded, limit, limitReset }
            { status: 'pending-oauth', accumulatedAmount, ruleNames }
       └─ no-claim: render nothing
       └─ minted: render reveal modal with copy-to-clipboard, plain-English limit/reset
       └─ pending-oauth: render "Claim your $X OpenRouter credits" CTA
            click → generate code_verifier, sessionStorage.set('or-pkce-verifier', verifier)
                  → window.location = `https://openrouter.ai/auth?callback_url=<spa-url>/?or_oauth_code=&code_challenge=<sha256(verifier)>&code_challenge_method=S256`
              (the trailing `?or_oauth_code=` is intentional — OpenRouter appends `&code=...` per its docs;
               our handler reads `code` directly. Alternatively, `callback_url=<spa-url>/` and we parse the
               `code` param OpenRouter adds. Verify wire format during implementation.)
            (learner signs up at openrouter.ai if needed — single screen)
            (callback redirects back to <spa-url>/?code=...)
            SPA renders LessonsList; <PluginSlot name="learnerHomeBanner"> mounts;
              LearnerHomeBanner detects `code` query param, reads verifier from sessionStorage, sessionStorage.delete
            POST /v1/plugins/openrouter-rewards/claim { code, code_verifier }
            Server: exchange → { key, user_id }; discard `key`; persist openrouterUserId
                    POST /api/v1/workspaces/{workspace_id}/members/add { user_ids: [user_id] }
                    POST /api/v1/keys { workspace_id, name, creator_user_id: user_id, limit: accumulatedAmount, limit_reset, expires_at }
                    clear pendingClaim; persist keyHash, lifetimeAwarded, firedRuleIds, issuedAt
                    emit('openrouter-rewards.keyAwarded', { userId, email, plaintext, ... })
            Response: { status: 'minted', plaintext, ... }
       └─ Reveal modal renders.
       └─ Slack handler (out of band): subscribed via Slack plugin's onActivate; receives the event,
          resolves email→slackUserId via Slack API, sends DM with the plaintext.

[Learner returns later, has lost the key]
  └─ Settings page → <PluginSlot name="learnerProfileFields"> mounts
       └─ Plugin component calls GET /v1/plugins/openrouter-rewards/status
       └─ Renders status card: limit, usage (live from OpenRouter via /api/v1/keys/:hash), last issued at.
       └─ "Reissue key" button — POST /v1/plugins/openrouter-rewards/reissue
            Server: getKey → carry remaining = limit - usage
                    DELETE old hash; POST new key with limit = remaining
                    return new plaintext
                    emit keyAwarded
            Cooldown enforced from lastReissueAt + reissueCooldownHours (returns 429 with Retry-After).
```

## Architecture

### New plugin

```
plugins/openrouter-rewards/
  manifest.json
  server/
    index.js             ← onActivate (backfill), routes, hook handlers, emit
    openrouter-client.js ← POST/PATCH/DELETE /api/v1/keys, OAuth exchange, workspace member-add
    rules.js             ← pure evaluateRules(rules, state, completionEvent, allCompletions) → matchedRules[]
    rules.test.js
    openrouter-client.test.js
    index.test.js
  client/
    AdminSettingsPanel.jsx     ← rule list editor + master key field + workspace id + test button
    AdminProfileFields.jsx     ← per-learner status, revoke, force reissue
    LearnerProfileFields.jsx   ← "your AI key" status card + reissue button
    LearnerCompletionAfter.jsx ← reveal-or-claim modal mounted at lesson completion
    LearnerHomeBanner.jsx      ← detects ?or_oauth_code= on home, completes claim, shows reveal modal
    index.js                   ← exports default { slots: { ... } }
```

### Manifest

```json
{
  "id": "openrouter-rewards",
  "name": "OpenRouter Rewards",
  "version": "0.1.0",
  "platoApiVersion": "^1.2.0",
  "description": "Issue OpenRouter API keys as configurable lesson-completion rewards.",
  "capabilities": [
    "server.routes",
    "settings.read",
    "settings.write",
    "user.metadata.read",
    "user.metadata.write",
    "ui.slot.adminSettingsPanel",
    "ui.slot.adminProfileFields",
    "ui.slot.learnerProfileFields",
    "ui.slot.learnerCompletionAfter",
    "ui.slot.learnerHomeBanner"
  ],
  "extensionPoints": {
    "serverRoutes": "server/index.js",
    "slots": [
      { "name": "adminSettingsPanel",     "component": "client/AdminSettingsPanel.jsx" },
      { "name": "adminProfileFields",     "component": "client/AdminProfileFields.jsx" },
      { "name": "learnerProfileFields",   "component": "client/LearnerProfileFields.jsx" },
      { "name": "learnerCompletionAfter", "component": "client/LearnerCompletionAfter.jsx" },
      { "name": "learnerHomeBanner",      "component": "client/LearnerHomeBanner.jsx" }
    ]
  },
  "settingsSchema": {
    "managementKey":            { "type": "string", "writeOnly": true, "description": "OpenRouter management/provisioning key (Bearer token for /api/v1/keys)" },
    "workspaceId":              { "type": "string", "description": "OpenRouter workspace ID for the classroom" },
    "rules":                    { "type": "array", "default": [] },
    "reissueCooldownHours":     { "type": "number", "default": 24 },
    "keyNameTemplate":          { "type": "string", "default": "plato:{classroomName}:{userEmail}" }
  }
}
```

### Core changes

These changes finish Phase 2 plugin surface that was already declared in `docs/plugins/EXTENSION_REFERENCE.md` and the SDK type-defs. They are plugin-agnostic — they unblock any future plugin needing the same surfaces. **No new core surfaces or capabilities are introduced; we are only mounting slots that were declared but never rendered.**

1. **`packages/plugin-sdk/index.d.ts`** — add `learnerCompletionAfter` to the `SlotName` union (the others — `learnerProfileFields`, `learnerHomeBanner` — are already declared).
2. **`docs/plugins/plugin.schema.json`** — add `learnerCompletionAfter` to the slot enum.
3. **`docs/plugins/EXTENSION_REFERENCE.md`** — add a `learnerCompletionAfter` section; promote `learnerProfileFields` and `learnerHomeBanner` from Phase 2 to Phase 1 (rendered).
4. **`server/src/lib/plugins/version.js`** — bump `PLUGIN_API_VERSION` to `1.3.0` per `docs/plugins/API_VERSIONING.md`.
5. **`client/src/pages/LessonChat.jsx`** — mount `<PluginSlot name="learnerCompletionAfter" context={{ lessonId, lessonKB }} />` directly after the existing completion celebration.
6. **`client/src/pages/Settings.jsx`** — mount `<PluginSlot name="learnerProfileFields" context={{ profile }} />` in a new section below existing settings.
7. **`client/src/pages/LessonsList.jsx`** — mount `<PluginSlot name="learnerHomeBanner" />` at the top of the lessons list (the post-login landing). This is where the OAuth callback resolves: OpenRouter redirects the learner to `<spa>/?or_oauth_code=<code>`, the SPA lands on the lessons list, and the plugin's `LearnerHomeBanner` component detects the query param, completes the claim, and shows the reveal modal in place of the banner.

The `lessonCompleted` hook is **not** required for this plugin. The reward-evaluation trigger is the client calling `POST /check-pending` on completion-modal mount, which preserves the no-plaintext-at-rest invariant by returning the plaintext synchronously. Plaintext lives only in the in-flight HTTP response; no token-store mechanism, no Lambda-instance affinity, no server-side OAuth callback route required.

### Slack plugin change

One file, `plugins/slack/server/index.js`. In `onActivate(ctx)`, register a hook listener:

```js
ctx.on('openrouter-rewards.keyAwarded', async (payload) => {
  const settings = await ctx.getSettings();
  if (!settings?.botToken) return;
  try {
    const slackUserId = await resolveSlackUserByEmail(settings.botToken, payload.email);
    if (!slackUserId) {
      ctx.logger.info('openrouter_dm_skipped_no_slack_user', { email: payload.email });
      return;
    }
    await sendSlackDM(settings.botToken, slackUserId, formatKeyAwardMessage(payload));
  } catch (err) {
    ctx.logger.warn('openrouter_dm_failed', { error: err.message });
  }
});
```

`resolveSlackUserByEmail` reuses the email-matching logic already in `slack-client.js`. Failure is fail-open — Slack DM is a bonus channel, not a hard requirement; the in-app reveal is the primary delivery.

## Data model

### Plugin settings

Stored at `_system:plugins:activation.openrouter-rewards.settings`.

```json
{
  "managementKey": "<writeOnly secret>",
  "workspaceId": "ws_...",
  "rules": [
    {
      "id": "<uuid>",
      "name": "Welcome key",
      "trigger": "lesson-count",
      "value": 5,
      "creditAmount": 5.0,
      "limitReset": "monthly",
      "expiresAfterDays": null
    },
    {
      "id": "<uuid>",
      "name": "Ethics capstone",
      "trigger": "specific-lesson",
      "value": "ethics-capstone",
      "creditAmount": 3.0,
      "limitReset": null,
      "expiresAfterDays": 90
    }
  ],
  "reissueCooldownHours": 24,
  "keyNameTemplate": "plato:{classroomName}:{userEmail}"
}
```

### Per-user state

Stored at `userMeta:openrouter-rewards`. Admin-owned (per the `userMeta:*` invariant in `docs/plugins/EXTENSION_REFERENCE.md` — learners can't read or modify these via `/v1/sync`).

```json
{
  "openrouterUserId": "user_...",
  "keyHash": "sha-...",
  "lifetimeAwarded": 5.0,
  "firedRuleIds": ["<uuid>", "<uuid>"],
  "issuedAt": "2026-05-05T12:00:00Z",
  "lastReissueAt": "2026-05-05T12:00:00Z",
  "pendingClaim": null,
  "deliveryAttempts": [
    { "channel": "in-app", "at": "2026-05-05T12:00:00Z", "ok": true },
    { "channel": "slack",  "at": "2026-05-05T12:00:01Z", "ok": true }
  ]
}
```

`pendingClaim` shape when active:

```json
{
  "ruleIds": ["<uuid>"],
  "accumulatedAmount": 5.0,
  "qualifiedAt": "2026-05-05T11:59:00Z"
}
```

**Invariant: plato never stores plaintext at rest.** Plaintext exists only in:
- The HTTP response body of `POST /check-pending` (when status is `minted`).
- The HTTP response body of `POST /claim`.
- The HTTP response body of `POST /reissue`.
- The synchronous in-memory event payload of `openrouter-rewards.keyAwarded` (consumed by the Slack handler within the same Lambda invocation; not persisted by the host or by the Slack plugin).

## OpenRouter API contract

### Endpoints used (auth: `Authorization: Bearer <managementKey>`)

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/auth/keys` | Exchange OAuth code | `{ code, code_verifier, code_challenge_method: "S256" }` → `{ key, user_id }` |
| POST | `/api/v1/workspaces/{id}/members/add` | Add learner to classroom workspace | `{ user_ids: [user_id] }` |
| POST | `/api/v1/keys` | Mint key | `{ name, workspace_id, creator_user_id, limit, limit_reset, expires_at }` → `{ key, data: { hash, ... } }` |
| GET | `/api/v1/keys/:hash` | Read usage before reissue | → `{ data: { limit, usage, ... } }` |
| PATCH | `/api/v1/keys/:hash` | Update (disable, retitle, change limit) | `{ disabled, limit, name }` |
| DELETE | `/api/v1/keys/:hash` | Hard delete | — |

The `key` in the auth-keys response is **discarded**; we use the management key (admin's) for all subsequent server-side calls. The OAuth round-trip's only purpose is to obtain `user_id` (and to make the learner an actual OpenRouter user).

### OAuth PKCE specifics

- Authorization URL: `https://openrouter.ai/auth?callback_url=<spa>/oauth/openrouter-rewards&code_challenge=<challenge>&code_challenge_method=S256`
- `<challenge>` = base64url(sha256(`code_verifier`)).
- `<code_verifier>` = 64+ random characters; generated client-side; stored in `sessionStorage` keyed by `or-pkce-verifier`.
- Callback URL must match exactly what's sent at authorize time. plato uses its `APP_URL` setting (already exposed via the SDK) to build it.
- No client registration required (per OpenRouter docs as of 2026-05).

## Rule evaluation

### Hot path (`POST /check-pending`)

```js
async function checkPending({ userId, lessonId }) {
  const settings = await ctx.getSettings();
  const state = (await ctx.getUserMeta(userId, 'openrouter-rewards')) ?? emptyState();

  // 1. Build the user's completed-lesson set (from lessonKB:* sync-data).
  const completions = await listCompletedLessons(userId);

  // 2. Evaluate rules — pure function.
  const matched = evaluateRules(settings.rules, state, completions, lessonId);
  if (matched.length === 0) return { status: 'no-claim' };

  const totalCredit = matched.reduce((s, r) => s + r.creditAmount, 0);

  // 3a. Not connected to OpenRouter yet → write pending claim, prompt OAuth.
  if (!state.openrouterUserId) {
    state.pendingClaim = {
      ruleIds: matched.map((r) => r.id),
      accumulatedAmount: (state.pendingClaim?.accumulatedAmount ?? 0) + totalCredit,
      qualifiedAt: nowIso(),
    };
    await ctx.putUserMeta(userId, 'openrouter-rewards', state);
    return {
      status: 'pending-oauth',
      accumulatedAmount: state.pendingClaim.accumulatedAmount,
      ruleNames: matched.map((r) => r.name),
    };
  }

  // 3b. Already connected → mint or top up.
  const { plaintext, hash, limit } = state.keyHash
    ? await reissueWithCarryover(state.keyHash, totalCredit, settings)
    : await mintInitial(state.openrouterUserId, totalCredit, settings);

  state.keyHash = hash;
  state.lifetimeAwarded += totalCredit;
  state.firedRuleIds = unique([...state.firedRuleIds, ...matched.map((r) => r.id)]);
  state.issuedAt ??= nowIso();
  state.lastReissueAt = nowIso();
  await ctx.putUserMeta(userId, 'openrouter-rewards', state);

  await ctx.emit('openrouter-rewards.keyAwarded', {
    userId,
    email: await db.getUserEmail(userId),
    plaintext,
    lifetimeAwarded: state.lifetimeAwarded,
    matchedRuleNames: matched.map((r) => r.name),
  });

  return { status: 'minted', plaintext, lifetimeAwarded: state.lifetimeAwarded, limit };
}
```

### `evaluateRules` (pure)

```js
function evaluateRules(rules, state, completions, justCompletedLessonId) {
  const fired = new Set(state.firedRuleIds ?? []);
  return rules.filter((r) => {
    if (fired.has(r.id)) return false;
    if (r.trigger === 'lesson-count') {
      return completions.length >= r.value;
    }
    if (r.trigger === 'specific-lesson') {
      return completions.some((c) => c.lessonId === r.value);
    }
    return false;
  });
}
```

**`completions` semantics:** the set of distinct `lessonKB:<lessonId>` records for the user where `status === 'completed'`. The just-completed lesson is included because its lessonKB write happens before `check-pending` fires. Re-completion of an already-completed lesson does not double-count (lessonKB write is keyed by lesson id; status flipping `completed → completed` is a no-op for this counter).

**`keyNameTemplate` placeholders:** `{classroomName}` is read from `_system:settings.classroomName` (the value managed by the existing branding admin), `{userEmail}` from the user record. If a placeholder is missing, it expands to the empty string. Default template `plato:{classroomName}:{userEmail}` produces e.g. `plato:UIC OSF:learner@uic.edu`.

### Backfill path (`onActivate`)

When the plugin is first enabled or activated after being disabled:
- Iterate users via `db.listAllUsers()`.
- For each user, build `completions` from their `lessonKB:*` records.
- Call `evaluateRules`. If matches and user is connected, mint as above. If matches and user is *not* connected, write `pendingClaim`. Skip users with no matches.
- Write `state.backfilledAt = <ISO timestamp>` so subsequent activations are no-ops for already-evaluated rules.
- Backfill never sends Slack DMs — the learner isn't online to copy the in-app reveal anyway, so a Slack DM with a key would arrive without the plato-side context. Reveal happens next time they log in (their `pendingClaim` triggers the CTA on their next lesson-completion or they see it in Settings).

### Reissue path (`POST /reissue`, learner-initiated)

- Auth required.
- Cooldown: reject with 429 if `now - state.lastReissueAt < settings.reissueCooldownHours * 3600`.
- `getKey(state.keyHash)` → `remaining = max(0, limit - usage)`.
- `DELETE /api/v1/keys/:hash`; `POST /api/v1/keys` with `limit: remaining`.
- Update `state.keyHash`, `state.lastReissueAt`. `lifetimeAwarded` unchanged.
- Emit `keyAwarded` so Slack DM fires.
- Return `{ plaintext, limit: remaining }`.

### Revoke path (`POST /admin/revoke/:userId`)

- `requireAdmin`.
- `DELETE /api/v1/keys/:hash`.
- Set `state.keyHash = null`, append `{ revokedAt, revokedBy }` to a small audit array on `state`.
- Audit-log entry via the host's audit logger.

## Failure modes

| Failure | Behavior |
|---|---|
| OpenRouter API 4xx (auth/validation) | Surface the OpenRouter error message verbatim to the client. Log `openrouter_api_4xx` with code+endpoint. State is unchanged (`firedRuleIds` not appended) so the rule will retry on the next qualifying event. |
| OpenRouter API 5xx / network | Same as above but log `openrouter_api_5xx`. Client-side: show "we couldn't reach OpenRouter — try again in a moment". |
| OAuth code expired or replayed | `POST /api/v1/auth/keys` returns 4xx → surface to client → "session expired, click Claim again". `pendingClaim` survives (the rule didn't fire) so a fresh OAuth round resolves it. |
| Workspace member-add fails (e.g. workspace full, deleted, perms) | Treat as fatal for this claim attempt. Don't proceed to mint. Surface the error. State unchanged. |
| `lessonKB` PUT fires twice for the same completion | Second call to `check-pending` returns `no-claim` because the rule's id is already in `firedRuleIds` after the first. Idempotent. |
| Two concurrent `check-pending` requests for the same user | Race condition on `userMeta` read-modify-write. Mitigation: rely on DynamoDB's per-item conditional write (the existing `putUserMeta` implementation; verify it uses a `attribute_not_exists` or version field, otherwise add a `version` field as part of this PR). The losing write retries from the latest state. |
| Slack DM fails | Logged, recorded in `deliveryAttempts`; in-app reveal is the source of truth. |
| Reveal modal closed before learner copies the key | Click "Reissue key" in Settings — generates a new plaintext (cooldown applies). |
| Lambda cold-start during OAuth callback | OAuth verifier is in the browser's `sessionStorage`, not Lambda memory; cold-start has no effect on PKCE. |

## Security review

- **Master key (`managementKey`)** — `writeOnly: true` in settingsSchema strips it from `GET /v1/admin/plugins`. Server reads only via `ctx.settings`. Never logged.
- **Plaintext keys** — never persisted. See data-model invariant. The synchronous `keyAwarded` event payload is the only in-process exposure outside the immediate HTTP response; only the host-shipped Slack plugin subscribes today.
- **OAuth verifier handling** — generated client-side, stored in `sessionStorage` (not `localStorage`), deleted immediately after the `claim` POST. PKCE protects against code interception.
- **Workspace ID validation** — server validates that the configured `workspaceId` actually belongs to the management key's organization (call `GET /api/v1/workspaces` once on settings save, reject if missing). Prevents an admin from typo'ing into someone else's workspace.
- **Per-learner key auditing** — every key carries `creator_user_id: <openrouter user id>` and `name: <template>`. Org admins can audit usage in OpenRouter's own dashboard.
- **Learner cannot escalate** — all mint/reissue/revoke routes verify auth; learners can only mint or reissue their own state. Revoke is admin-only.
- **CSRF on `/claim`** — POST with `Content-Type: application/json` requires explicit CORS allowance. plato's existing CORS config rejects cross-origin POSTs.

## Testing

### Server (Vitest)

- `rules.test.js` — pure rule evaluator: lesson-count threshold met/not-met, specific-lesson match, dedup via `firedRuleIds`, multi-rule fan-out, mixed triggers.
- `openrouter-client.test.js` — mocks `fetch`; asserts request shapes for mint/reissue/delete/oauth-exchange/workspace-add and surfaces error bodies.
- `index.test.js` — integration: `check-pending` returns each of the three statuses correctly given mocked OpenRouter responses; `claim` end-to-end; `reissue` honors cooldown; `revoke` is admin-gated.
- `slack-listener.test.js` (in `plugins/slack/`) — assert listener subscribes; assert DM is sent on event with mocked Slack client; assert fail-open when no Slack user matches.

### Client

- Component tests for `LearnerCompletionAfter` covering each of the three states (no-claim, minted, pending-oauth).
- Component test for `OAuthCallbackPage` — mocks `sessionStorage` verifier, asserts POST to `/claim` with the right payload, asserts redirect to a "claim succeeded" surface.

### Manual smoke

- Spin up dev server; configure plugin with a real OpenRouter management key + workspace.
- Complete a lesson with a `lesson-count: 1` rule active.
- Walk through the OAuth round-trip end-to-end.
- Verify the key works against `https://openrouter.ai/api/v1/chat/completions`.
- Verify the Slack DM arrives if Slack plugin is enabled.
- Click "Reissue" in Settings; verify cooldown blocks a second click within 24h.

## Open questions

(none gating implementation — all design decisions locked above)

## Decisions captured during brainstorming

| # | Decision | Choice |
|---|---|---|
| 1 | Award model | One key per learner, refilled (not multi-key, not per-event) |
| 2 | Rule shape | One rule list, multi-type rules (`lesson-count` and `specific-lesson`) |
| 3 | Reveal UX | One-time in-app reveal; plaintext never at rest in plato |
| 4 | Implementation surface | Plugin + small generic core additions that finish Phase 2 plugin surface |
| 5 | Rule semantics | Per-rule one-shot; backfill on first activate |
| 6 | Slack delivery | Always when Slack plugin enabled & email matches; no toggle |
| 7 | OpenRouter identity | Workspace-scoped sub-keys minted with `creator_user_id` from learner's OpenRouter user id |
| 8 | OAuth timing | Lazy — prompt only when there's something to claim |
| 9 | Mint trigger | Client-initiated `POST /check-pending` (avoids needing the `lessonCompleted` core hook for this plugin) |
