# OpenRouter Rewards Plugin - Design

**Status:** Design, pre-implementation, gated by OpenRouter API spike
**Date:** 2026-05-05
**Author:** brainstormed with Henry Perkins
**Repo:** plato

## Summary

A new plato plugin, `plugins/openrouter-rewards/`, issues OpenRouter API keys to learners as configurable lesson-completion rewards. Admins define reward rules such as "after N lessons" or "after a specific lesson." When a learner satisfies a rule, plato either asks them to connect an OpenRouter account via OAuth PKCE or, if they are already connected, tops up their existing workspace-scoped key.

The target design satisfies the original ask with one external dependency: OpenRouter must support creating or managing classroom workspace keys for OAuth-created learner users.

- Provision keys after completing X lessons or after a specific lesson.
- Let learners complete quick OpenRouter signup/authorization through OAuth PKCE.
- Display the key in plato once when plaintext exists.
- Optionally DM the learner through Slack if the admin explicitly enables Slack key delivery.

## Gating API Assumptions

OpenRouter's documented `POST /api/v1/workspaces/{id}/members/add` endpoint adds organization members to a workspace. This design depends on one of these being true:

- An OAuth-created `user_id` is, or can be made, an organization member by the classroom's management key.
- A workspace API key can be created with `workspace_id` and `creator_user_id` for a user who is not already a workspace member.
- OpenRouter has another invite/member endpoint that completes the organization-membership step without manual admin work.

OpenRouter's organization docs also currently state that an organization can only have 10 members. If workspace-scoped learner keys require every learner to become an organization member, this design will not scale for normal classrooms without OpenRouter support or enterprise changes.

Before implementation, run a real API spike with a management key and a learner account that is not already in the organization. If none of the membership/key-creation paths works, this spec must change to an org-invite/manual-approval flow or drop the workspace-scoped reward requirement.

The API spike must also verify whether OpenRouter supports in-place key top-ups via `PATCH /api/v1/keys/:hash`. The preferred design keeps one stable key per learner and increases its limit. If OpenRouter cannot increase an existing key limit, replacement-key top-ups become an explicit degraded mode with user-facing warnings.

## Non-Goals

- Funding the learner's personal OpenRouter account. Classroom credits stay in the classroom workspace.
- Storing plaintext OpenRouter keys at rest in plato.
- Letting admins directly generate or view learner plaintext keys.
- Replacing or augmenting the lesson completion decision. `applyCoachResponseToKB` remains the single owner of lesson completion.
- Supporting multiple simultaneous key buckets in v1. All enabled reward rules must share one key policy.

## Required Core Work

These core changes must land before implementing `plugins/openrouter-rewards/`.

1. Preserve omitted write-only settings on save.
2. Add supported SDK exports for version-aware user metadata writes and targeted secret-event delivery.
3. Render learner plugin slots: `learnerProfileFields`, `learnerHomeBanner`, and `learnerCompletionAfter`.
4. Bump `PLUGIN_API_VERSION` after the new slots and SDK contracts are documented.
5. Update plugin schema, manifest validator, SDK types, extension reference, API versioning docs, capabilities docs, and tests.

### Write-Only Settings Preservation

The current host settings endpoint replaces the full settings object. That would erase `managementKey` when a custom settings panel saves visible fields without sending the existing write-only secret, because write-only values are never returned to the client.

Core must add host-level merge semantics for write-only fields:

- In `pluginRegistry.updateSettings(id, nextSettings)`, omitted `settingsSchema.properties[key].writeOnly === true` fields are copied from the existing settings record.
- Sending a new value explicitly replaces the old value.
- Sending `null` or an empty string explicitly clears the value only when the plugin UI intentionally sends it.
- Sanitized admin and learner responses continue stripping write-only fields.

Tests must prove preservation, replacement, explicit clearing, and response sanitization.

### SDK Exports

Plugin code must not import private host internals such as `server/src/lib/plugins/hooks.js`, `server/src/lib/plugins/registry.js`, or raw DB helpers unless those APIs are re-exported through `server/src/lib/plugins/sdk.js`.

Add supported SDK exports before this plugin relies on them:

```js
export { emit, on } from './hooks.js';
export { createPluginLogger } from './logger.js';
export { emitSecret } from './secret-events.js';
export async function getPluginRuntime(pluginId) { /* enabled + sanitized runtime metadata for the caller's plugin */ }
export async function getUserMetaWithVersion(userId, pluginId) { /* { data, version } */ }
export async function putUserMetaConditional(userId, pluginId, data, expectedVersion) { /* optimistic write */ }
```

`getUserMetaWithVersion` and `putUserMetaConditional` are required because OpenRouter key creation is an external side effect. The plugin must reserve rule IDs with optimistic locking before calling OpenRouter. `emitSecret` is required because plaintext key delivery must be targeted to a manifest-declared handler instead of broadcast on the open hook bus.

### Learner Slots

Add or finalize these generic render points:

- `learnerProfileFields` in `client/src/pages/Settings.jsx`, with props `{ profile }`.
- `learnerHomeBanner` in `client/src/pages/LessonsList.jsx`, with props `{}`.
- `learnerCompletionAfter` in `client/src/pages/LessonChat.jsx`, with props `{ lessonId, lessonKB }`, mounted only after completion is achieved.

Update:

- `packages/plugin-sdk/index.d.ts`
- `docs/plugins/plugin.schema.json`
- `server/src/lib/plugins/manifest.js`
- `server/src/routes/me.js` extension-points inventory
- `docs/plugins/EXTENSION_REFERENCE.md`
- `docs/plugins/API_VERSIONING.md`
- `docs/plugins/CAPABILITIES.md` if new SDK/capability vocabulary is added

## User-Facing Flows

### Admin: Configure Rewards

1. Admin opens `/plato/plugins`, enables OpenRouter Rewards, and expands settings.
2. Admin enters an OpenRouter management/provisioning key. The field is `writeOnly`.
3. Admin enters the OpenRouter workspace ID.
4. Admin clicks "Test connection." The server calls `GET /api/v1/keys` and `GET /api/v1/workspaces` and verifies the configured workspace belongs to the management key.
5. Admin adds reward rules. Each rule has name, trigger, value, credit amount, limit reset cadence, and optional expiry.
6. Settings validation requires every enabled rule to share the same `limitReset` and `expiresAfterDays` values in v1.
7. Admin optionally enables Slack DM delivery after seeing the retention warning.
8. Admin sets reissue cooldown, default 24 hours.
9. Admin saves.

Slack delivery warning copy:

> Slack delivery sends the API key as a Slack message. Slack may retain this message according to your workspace retention policy. plato will not store the plaintext key.

### Admin: Per-Learner View

`AdminProfileFields` slot in the admin user-edit page shows, when the plugin is enabled:

- Connected OpenRouter user ID, truncated, with connection status.
- Current key hash, truncated, plus lifetime awarded and rules fired count.
- Active key policy.
- Pending OAuth, pending claim, and pending reissue indicators.
- Link to `https://openrouter.ai/settings/keys` in a new tab. Admin can see key record, status, and usage in OpenRouter, not plaintext.
- Buttons: Revoke and Queue reissue.

Admin reissue is queued, not forced. The admin action records `pendingReissue`; the learner must claim the replacement while online so plaintext is returned only to the learner.

### Learner: Earn, Claim, Use

```text
[Lesson completes - coach awards progress 10 - applyCoachResponseToKB sets status=completed]
  -> LessonChat.jsx renders existing completion celebration.
  -> <PluginSlot name="learnerCompletionAfter"> mounts.
  -> Plugin component calls POST /v1/plugins/openrouter-rewards/check-pending with { lessonId }.
  -> Server response is one of:
       { status: 'no-claim' }
       { status: 'topped-up', addedCredit, lifetimeAwarded, limit }
       { status: 'minted', plaintext, lifetimeAwarded, limit, limitReset }
       { status: 'pending-oauth', accumulatedAmount, ruleNames }
```

Behavior by response:

- `no-claim`: render nothing.
- `topped-up`: show a non-secret confirmation that the learner's existing key limit increased.
- `minted`: render a one-time reveal modal with copy-to-clipboard and plain-English limit/reset details.
- `pending-oauth`: render "Claim your $X OpenRouter credits" CTA.

OAuth claim flow:

1. Client generates `code_verifier` and `code_challenge`.
2. Client calls `POST /v1/plugins/openrouter-rewards/oauth/start` with `{ codeChallenge }`.
3. Server verifies the learner has a `pendingClaim`, computes `claimFingerprint`, stores `{ stateHash, codeChallenge, claimFingerprint, expiresAt }` in user metadata, and returns `{ authorizationUrl, state }`.
4. Client stores `code_verifier` in `sessionStorage` as `or-pkce-verifier:<state>` and redirects to `authorizationUrl`.
5. OpenRouter redirects back with `?code=...&state=...`.
6. `LearnerHomeBanner` reads `state`, loads and removes `or-pkce-verifier:<state>`, and calls `POST /claim` with `{ code, state, codeVerifier }`.
7. Server hashes `state`, consumes a non-expired session for this user, verifies the stored `codeChallenge` matches `codeVerifier`, verifies `pendingClaim.claimFingerprint` still matches, then exchanges the OAuth code.
8. Server associates the learner with the workspace if the API spike proves this is possible, creates the first key, persists non-secret state, returns plaintext, and optionally emits a targeted Slack secret event.
9. Reveal modal shows the key once.

Learner reveal copy must include:

> This key is shown once in plato. If your classroom enabled Slack delivery, it may also appear in Slack.

### Learner: Reissue After Losing A Key

1. Learner opens Settings.
2. `<PluginSlot name="learnerProfileFields">` mounts.
3. Plugin calls `GET /status` and renders current non-secret state.
4. Learner clicks "Reissue key."
5. Server enforces cooldown unless the reissue was admin-queued.
6. Server creates a new key with remaining credit before deleting/disabling the old key.
7. Server updates `keyHash`, `lastReissueAt`, clears `pendingReissue`, returns plaintext once, and optionally sends Slack DM if enabled.

### Admin-Queued Reissue

1. Admin clicks "Queue reissue" in the learner profile plugin slot.
2. Server writes `pendingReissue` with optimistic locking and audit logs `openrouter_reissue_requested`.
3. Learner sees a home/settings CTA.
4. Learner completes `POST /reissue` while online and receives the plaintext.

## Architecture

### Plugin Files

```text
plugins/openrouter-rewards/
  plugin.json
  server/
    index.js             - routes, activation/backfill, event emit
    openrouter-client.js - OAuth, key CRUD, workspace member-add
    rules.js             - pure rule evaluation and policy validation
    rules.test.js
    openrouter-client.test.js
    index.test.js
  client/
    AdminSettingsPanel.jsx
    AdminProfileFields.jsx
    LearnerProfileFields.jsx
    LearnerCompletionAfter.jsx
    LearnerHomeBanner.jsx
    index.js
```

### Manifest

```json
{
  "$schema": "../../docs/plugins/plugin.schema.json",
  "id": "openrouter-rewards",
  "name": "OpenRouter Rewards",
  "version": "0.1.0",
  "apiVersion": "^1.3.0",
  "description": "Issue OpenRouter API keys as configurable lesson-completion rewards.",
  "author": "plato core",
  "license": "AGPL-3.0-or-later",
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
    "serverRoutes": "server/index.js#default",
    "slots": {
      "adminSettingsPanel": "client/AdminSettingsPanel.jsx",
      "adminProfileFields": "client/AdminProfileFields.jsx",
      "learnerProfileFields": "client/LearnerProfileFields.jsx",
      "learnerCompletionAfter": "client/LearnerCompletionAfter.jsx",
      "learnerHomeBanner": "client/LearnerHomeBanner.jsx"
    }
  },
  "settingsSchema": {
    "type": "object",
    "properties": {
      "managementKey": { "type": "string", "writeOnly": true, "description": "OpenRouter management/provisioning key." },
      "workspaceId": { "type": "string", "description": "OpenRouter workspace ID or slug for the classroom." },
      "reissueCooldownHours": { "type": "number", "default": 24 },
      "keyNameTemplate": { "type": "string", "default": "plato:{classroomName}:{userEmail}" },
      "delivery": {
        "type": "object",
        "properties": {
          "inAppReveal": { "type": "boolean", "default": true },
          "slackDmEnabled": { "type": "boolean", "default": false }
        }
      }
    }
  }
}
```

`rules` are managed by the custom `AdminSettingsPanel` and stored in settings, but intentionally omitted from `settingsSchema` because plato's fallback schema renderer is not intended for arrays of objects. The custom panel must omit `managementKey` unless the admin enters a replacement; the host must preserve omitted write-only fields.

### Slack Plugin Change

OpenRouter Rewards never emits plaintext on the open plugin hook bus. For Slack delivery, the core plugin host provides targeted secret events. Slack declares a manifest secret handler for `openrouter-rewards.keyAwarded`. The OpenRouter plugin calls `emitSecret('openrouter-rewards.keyAwarded', 'slack', payload)`. Only the enabled Slack plugin's registered secret handler receives the plaintext payload. The public/open event, if emitted, contains only `{ userId, keyHashSuffix, deliveryAttemptId, status }`.

The Slack handler no-ops unless:

- Slack plugin is enabled.
- Slack plugin has a bot token.
- Secret event payload includes `slackDmAllowed === true`.
- Email resolves to a Slack user.

Failures are fail-open. Slack delivery is a bonus channel; in-app reveal is the primary delivery. The host manages manifest-declared secret handler registration and unregisters handlers when a plugin is disabled.

## Data Model

### Settings

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
      "expiresAfterDays": null,
      "enabled": true
    }
  ],
  "rulesVersion": "sha256:...",
  "delivery": {
    "inAppReveal": true,
    "slackDmEnabled": false
  },
  "reissueCooldownHours": 24,
  "keyNameTemplate": "plato:{classroomName}:{userEmail}"
}
```

The server computes `rulesVersion` from normalized rules on settings save. Do not trust a client-provided rules version.

### Per-User State

Stored at `userMeta:openrouter-rewards`. This is admin-owned per the `userMeta:*` invariant; learners cannot read or modify it through `/v1/sync`. Learner-visible data is exposed only through plugin routes.

```json
{
  "openrouterUserId": "user_...",
  "keyHash": "sha-...",
  "activeKeyPolicy": {
    "limitReset": "monthly",
    "expiresAfterDays": null
  },
  "lifetimeAwarded": 5.0,
  "firedRuleIds": ["<uuid>"],
  "issuedAt": "2026-05-05T12:00:00Z",
  "lastAwardedAt": "2026-05-05T12:00:00Z",
  "lastReissueAt": "2026-05-05T12:00:00Z",
  "pendingClaim": null,
  "oauthSessions": [],
  "pendingReissue": null,
  "reissueReservation": null,
  "reservations": [],
  "lastBackfilledRulesVersion": "sha256:...",
  "backfillRuns": [],
  "deliveryAttempts": []
}
```

`pendingClaim` shape:

```json
{
  "ruleIds": ["<uuid>"],
  "reservationIds": ["<uuid>"],
  "accumulatedAmount": 5.0,
  "qualifiedAt": "2026-05-05T11:59:00Z",
  "claimFingerprint": "sha256:..."
}
```

`oauthSessions` shape:

```json
{
  "stateHash": "sha256:...",
  "codeChallenge": "base64url...",
  "claimFingerprint": "sha256:...",
  "createdAt": "2026-05-05T12:01:00Z",
  "expiresAt": "2026-05-05T12:11:00Z"
}
```

`pendingReissue` shape:

```json
{
  "requestedAt": "2026-05-05T12:00:00Z",
  "requestedBy": "usr_admin",
  "reason": "admin-requested"
}
```

`reservations` shape:

```json
[
  {
    "id": "<uuid>",
    "kind": "award",
    "phase": "reserved",
    "ruleIds": ["<uuid>"],
    "amount": 5.0,
    "targetLimit": 10.0,
    "createdAt": "2026-05-05T11:59:00Z"
  }
]
```

Reservations make the rule-award and OpenRouter side-effect boundary idempotent. `evaluateRules` treats `firedRuleIds`, `pendingClaim.ruleIds`, and `reservations[*].ruleIds` as unavailable so repeated completion UI mounts cannot accumulate the same rule twice. Reservation phases are `reserved` before an OpenRouter mutation and `external-succeeded` after the mutation succeeds but before final state persistence completes.

### Plaintext Invariant

plato never stores plaintext OpenRouter keys at rest. Plaintext exists only in:

- The HTTP response body of `POST /check-pending` when first minting a key.
- The HTTP response body of `POST /claim`.
- The HTTP response body of `POST /reissue`.
- The targeted in-process secret event payload sent to a manifest-declared handler such as Slack.

OpenRouter Rewards never emits plaintext on the open plugin hook bus. Public/open events may include non-secret delivery summaries such as `{ userId, keyHashSuffix, deliveryAttemptId, status }`. If Slack delivery is enabled, Slack may store the API key in Slack message history according to the classroom's Slack retention policy. The invariant is about plato storage, not external systems.

## OpenRouter API Contract

### Endpoints Used

All management endpoints use `Authorization: Bearer <managementKey>`. The OAuth exchange auth requirement is ambiguous in OpenRouter docs and must be verified in Phase 0.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/auth/keys` | Exchange OAuth code | `{ code, code_verifier, code_challenge_method: "S256" }` -> `{ key, user_id }` |
| POST | `/api/v1/workspaces/{id}/members/add` | Add learner to workspace | `{ user_ids: [user_id] }` |
| POST | `/api/v1/keys` | Mint key | `{ name, workspace_id, creator_user_id, limit, limit_reset, expires_at }` -> `{ key, data: { hash, ... } }` |
| GET | `/api/v1/keys/:hash` | Read usage before reissue/top-up | `{ data: { limit, usage, limit_remaining, ... } }` |
| PATCH | `/api/v1/keys/:hash` | Top up or update key | `{ limit, disabled, name, limit_reset, expires_at }` |
| DELETE | `/api/v1/keys/:hash` | Delete old key after replacement | none |

The `key` returned from `POST /api/v1/auth/keys` is discarded if the workspace-scoped management flow works. The OAuth round trip exists to obtain `user_id` and ensure the learner has an OpenRouter identity.

### OAuth PKCE Specifics

- Client starts OAuth only through `POST /v1/plugins/openrouter-rewards/oauth/start` with `{ codeChallenge }`.
- Server refuses OAuth start without an existing `pendingClaim`.
- Server stores one-time `{ stateHash, codeChallenge, claimFingerprint, expiresAt }` in user metadata and returns the raw `state` only once.
- Authorization URL: `https://openrouter.ai/auth?callback_url=<spa-url>/&code_challenge=<challenge>&code_challenge_method=S256&state=<state>`.
- `<challenge>` is `base64url(sha256(code_verifier))`.
- `<code_verifier>` is 64+ random characters, generated client-side and stored in `sessionStorage` as `or-pkce-verifier:<state>`.
- `/claim` consumes the state, verifies the PKCE challenge, verifies the pending claim fingerprint did not change, and then exchanges the OAuth code.
- Callback URL must match exactly what was sent at authorization time.
- Client uses `window.location.origin + '/'` for callback target.
- Server uses `APP_URL` only for links/messages.
- No client registration required per OpenRouter docs as of 2026-05, pending spike verification.

## Rule Evaluation

### Settings Validation

V1 supports one active key bucket per learner. Therefore all enabled rules must share the same `limitReset` and `expiresAfterDays` values.

If the admin tries to save incompatible rules, reject with:

> All OpenRouter reward rules must use the same reset cadence and expiry in this version. Split-key rewards are not supported yet.

This avoids surprising aggregation behavior and preserves the one-key-per-learner design.

### Pure Evaluator

```js
function evaluateRules(rules, state, completions, justCompletedLessonId) {
  const firedOrPending = new Set([
    ...(state.firedRuleIds ?? []),
    ...(state.pendingClaim?.ruleIds ?? []),
    ...((state.reservations ?? []).flatMap((r) => r.ruleIds ?? [])),
  ]);

  return rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (firedOrPending.has(rule.id)) return false;
    if (rule.trigger === 'lesson-count') return completions.length >= rule.value;
    if (rule.trigger === 'specific-lesson') return completions.some((c) => c.lessonId === rule.value);
    return false;
  });
}
```

`completions` is the set of distinct `lessonKB:<lessonId>` records for the user where `status === 'completed'`. Re-completion of an already-completed lesson does not double-count.

### Hot Path: `POST /check-pending`

The hot path reserves matched rules before calling OpenRouter. A conditional write after minting is too late because OpenRouter key creation is a paid external side effect.

Route ordering is part of the idempotency contract:

- If `state.pendingClaim` exists, return `pending-oauth` before evaluating new rules.
- If an award reservation exists with phase `reserved` or `external-succeeded`, return `processing` and do not create another reservation.
- Only call `clearReservation` for failures that happen before any OpenRouter mutation succeeds.
- After an OpenRouter mutation succeeds, retry finalization from latest metadata. If persistence remains unavailable, run the documented compensation path instead of clearing the reservation.

```js
async function checkPending({ userId, lessonId }) {
  const settings = await readPluginSettings();
  const { data: state, version } = await getUserMetaWithVersion(userId, 'openrouter-rewards');
  const current = state ?? emptyState();

  if (current.pendingClaim) {
    return {
      status: 'pending-oauth',
      accumulatedAmount: current.pendingClaim.accumulatedAmount,
      ruleIds: current.pendingClaim.ruleIds,
    };
  }

  if ((current.reservations || []).some((r) => r.kind === 'award')) {
    return { status: 'processing' };
  }

  const completions = await listCompletedLessons(userId);
  const matched = evaluateRules(settings.rules, current, completions, lessonId);

  if (matched.length === 0) return { status: 'no-claim' };

  const award = buildAward(matched); // allowed only after policy validation
  const reservationId = crypto.randomUUID();
  const reserved = reserveAward(current, matched, award, reservationId);
  await putUserMetaConditional(userId, 'openrouter-rewards', reserved, version);

  if (!reserved.openrouterUserId) {
    return {
      status: 'pending-oauth',
      accumulatedAmount: reserved.pendingClaim.accumulatedAmount,
      ruleNames: matched.map((r) => r.name),
    };
  }

  let externalSucceeded = false;
  try {
    if (reserved.keyHash) {
      const topUp = await topUpExistingKey(reserved.keyHash, award, settings);
      externalSucceeded = true;
      const latest = await getUserMetaWithVersion(userId, 'openrouter-rewards');
      const finalState = finalizeReservation(latest.data, reservationId, { award, keyHash: reserved.keyHash });
      await putUserMetaConditional(userId, 'openrouter-rewards', finalState, latest.version);
      return { status: 'topped-up', addedCredit: award.amount, lifetimeAwarded: finalState.lifetimeAwarded, limit: topUp.limit };
    }

    const minted = await mintInitial(reserved.openrouterUserId, award, settings);
    externalSucceeded = true;
    const latest = await getUserMetaWithVersion(userId, 'openrouter-rewards');
    const finalState = finalizeReservation(latest.data, reservationId, { award, keyHash: minted.hash });
    await putUserMetaConditional(userId, 'openrouter-rewards', finalState, latest.version);

    if (settings.delivery?.slackDmEnabled === true) {
      await emitSecret('openrouter-rewards.keyAwarded', 'slack', buildKeyAwardedPayload({
        userId,
        plaintext: minted.plaintext,
        finalState,
        matchedRules: matched,
        slackDmAllowed: true,
      }));
    }

    return { status: 'minted', plaintext: minted.plaintext, lifetimeAwarded: finalState.lifetimeAwarded, limit: minted.limit };
  } catch (err) {
    if (!externalSucceeded) {
      const latest = await getUserMetaWithVersion(userId, 'openrouter-rewards');
      await putUserMetaConditional(userId, 'openrouter-rewards', clearReservation(latest.data, reservationId), latest.version);
    }
    throw err;
  }
}
```

### Top-Up Semantics

For a connected learner with an existing key, the preferred path is in-place top-up:

1. `GET /api/v1/keys/:hash`.
2. Compute new limit from current limit plus awarded credit.
3. `PATCH /api/v1/keys/:hash { limit: newLimit, limit_reset, expires_at? }`.
4. Persist `lifetimeAwarded`, `firedRuleIds`, and `lastAwardedAt`.
5. Return `topped-up` without plaintext.

If OpenRouter cannot patch limits, replacement-key top-up is allowed only as an explicitly documented degraded mode:

- Create the new key before deleting/disabling the old key.
- Return plaintext once.
- Warn the learner that previous integrations using the old key must be updated.
- Store `lastRotationReason: 'topup-requires-rotation'`.

### Backfill

Backfill must be rule-versioned, not a single `backfilledAt` guard.

Preferred v1 behavior:

- On first activation, run a bounded backfill that creates pending claims only.
- Do not mint keys or send Slack DMs during backfill.
- When rules change, settings UI shows "Rules changed. Run backfill to award learners who already qualify."
- Admin can run `POST /admin/backfill` for the current `rulesVersion`.
- Each user records `lastBackfilledRulesVersion` and `backfillRuns`.
- Rule IDs already fired, pending, or reserved are skipped.

This avoids heavy hidden work in settings save or boot while still supporting rules added after initial activation.

### Reissue

Learner-initiated reissue:

- Requires auth.
- Enforces cooldown from `lastReissueAt` unless `pendingReissue.reason === 'admin-requested'`.
- Reads current key and computes remaining credit as `max(0, data.limit_remaining ?? (data.limit - data.usage))`.
- If remaining credit is zero, delete or disable the old key, set `keyHash = null`, and return a friendly no-credit response.
- Creates the replacement key before deleting/disabling the old key.
- Updates `keyHash`, `lastReissueAt`, clears `pendingReissue`, returns plaintext, and optionally emits Slack delivery.

If old-key deletion fails after the new key is created, keep the new key as canonical, log `openrouter_old_key_delete_failed`, and surface a non-blocking admin warning. Do not roll back state or discard the new plaintext.

Admin-queued reissue:

- `POST /v1/plugins/openrouter-rewards/admin/reissue-request/:userId`.
- Requires admin.
- Writes `pendingReissue` with optimistic locking.
- Audit logs `openrouter_reissue_requested`.
- Does not call OpenRouter and does not generate plaintext.

### Revoke

- `POST /v1/plugins/openrouter-rewards/admin/revoke/:userId`.
- Requires admin.
- Deletes or disables the current OpenRouter key.
- Sets `state.keyHash = null`.
- Appends `{ revokedAt, revokedBy }` to audit state.
- Writes host audit log.

## API Surface

### Learner Routes

- `POST /v1/plugins/openrouter-rewards/check-pending`: returns `no-claim`, `pending-oauth`, `minted`, or `topped-up`.
- `POST /v1/plugins/openrouter-rewards/claim`: completes OAuth and mints first key.
- `GET /v1/plugins/openrouter-rewards/status`: returns non-secret state, top-up history, current key hash suffix, active policy, pending claim, and pending reissue.
- `POST /v1/plugins/openrouter-rewards/reissue`: learner-initiated or admin-queued key replacement; returns plaintext only on success.

### Admin Routes

- `POST /v1/plugins/openrouter-rewards/admin/test`: validates management key and workspace.
- `POST /v1/plugins/openrouter-rewards/admin/backfill`: runs rule-versioned backfill for current rules.
- `POST /v1/plugins/openrouter-rewards/admin/reissue-request/:userId`: queues learner-claimed reissue.
- `POST /v1/plugins/openrouter-rewards/admin/revoke/:userId`: revokes current key.

## Failure Modes

| Failure | Behavior |
|---|---|
| OpenRouter API 4xx before mutation | Surface useful OpenRouter error to client. Log `openrouter_api_4xx` with endpoint and status. Clear the in-flight reservation only when no OpenRouter mutation succeeded. Do not append `firedRuleIds`. |
| OpenRouter API 5xx or network before mutation | Log `openrouter_api_5xx`. Client shows retry message. Clear the in-flight reservation only when no OpenRouter mutation succeeded. |
| OAuth code expired or replayed | Claim returns 4xx. `pendingClaim` survives so learner can click Claim again. |
| Workspace member-add fails | Fatal for the claim attempt. Do not mint. Keep `pendingClaim` reserved so retry works after admin fixes config. |
| Existing key top-up unsupported | Use degraded replacement-key mode only if Phase 0 documented this limitation and UI warns learner. |
| Duplicate completion UI mounts | Second request sees rule IDs in `firedRuleIds`, `pendingClaim`, or `reservations` and returns `pending-oauth`, `processing`, or `no-claim` without creating a duplicate reservation. |
| Concurrent `check-pending` | First conditional metadata write wins. Loser re-reads and does not mint/top-up duplicate credit. |
| OpenRouter key created but final state write fails | Retry finalization from latest state using `reservationId`. If bounded retries fail, compensate by disabling the created key and logging `openrouter_created_key_compensated`; if compensation fails, log `openrouter_orphan_key_created` for admin cleanup. Never return plaintext until final state is persisted. |
| Slack DM fails | Log and record `deliveryAttempts`; in-app reveal remains source of truth. |
| Reveal modal closed before copy | Learner can reissue from Settings; cooldown applies unless admin queued it. |
| Lambda cold start during OAuth callback | No impact; verifier is in browser `sessionStorage`. |

## Security Review

- **Management key:** `writeOnly: true` strips it from admin and learner plugin responses. Server routes read it only from persisted plugin settings. Never log it.
- **Plaintext keys:** plato never stores plaintext at rest and never sends plaintext over the open plugin hook bus. Plaintext leaves the OpenRouter plugin only in authenticated HTTP responses and targeted secret events.
- **Slack delivery:** disabled by default and guarded by admin warning.
- **Admin reissue:** admins queue reissue; they cannot generate or view plaintext.
- **OAuth verifier:** generated client-side, stored in `sessionStorage`, removed after claim POST. PKCE protects against code interception.
- **Workspace validation:** settings save/test verifies configured workspace belongs to the management key.
- **Workspace membership validation:** Phase 0 must prove workspace membership or workspace key creation works for OAuth-created learners. No silent fallback to personal keys.
- **Learner cannot escalate:** all routes authenticate; learners can only act on their own state. Admin routes require `requireAdmin`.
- **CSRF:** plugin routes require bearer JWT in the `Authorization` header. plato does not use ambient auth cookies, so cross-site forms/images cannot authenticate. Current CORS is permissive and must not be cited as the primary CSRF control.

## Testing

### Phase 0 API Spike

- Complete OAuth as a test learner account that is not already an organization member.
- Verify whether `POST /api/v1/auth/keys` requires Authorization.
- Verify whether `POST /api/v1/workspaces/{id}/members/add { user_ids: [oauthUserId] }` succeeds.
- If workspace add fails, verify whether `POST /api/v1/keys { workspace_id, creator_user_id: oauthUserId, ... }` succeeds.
- Verify whether `PATCH /api/v1/keys/:hash` can increase an existing key limit.
- Verify whether `PATCH /api/v1/keys/:hash` can preserve or change `limit_reset` and expiry fields.
- Document response bodies/status codes in this spec before implementation starts.
- If neither workspace add nor workspace key creation works for non-member learners, stop and redesign around OpenRouter organization invites or manual approval.

## Phase 0 API Spike Results

Date: not yet run in this implementation branch

This branch implements the plugin behind the API assumptions above, but the production PR remains gated on a real OpenRouter spike with a non-production classroom workspace and a learner account that is not already an organization member. Before merge, replace this section with observed status codes, response body notes, and decisions for:

| Call | Status | Result | Decision |
|---|---:|---|---|
| POST /api/v1/auth/keys | not run | pending real OAuth exchange | keep or revise OAuth exchange implementation |
| POST /api/v1/workspaces/{id}/members/add | not run | pending membership behavior | keep workspace-member design or redesign |
| POST /api/v1/keys with workspace_id + creator_user_id | not run | pending key-creation behavior | keep learner-owned workspace key design or redesign |
| PATCH /api/v1/keys/:hash limit increase | not run | pending top-up behavior | keep in-place top-up or use replacement-key degraded mode |

### Core Tests

- Write-only settings preservation.
- Version-aware user meta helper success and conflict paths.
- SDK secret-event exports usable from plugins without internal imports.
- New slot names validate in schema, manifest validator, SDK types, and extension-points endpoint.

### Plugin Server Tests

- `rules.test.js`: count rules, specific-lesson rules, dedup via fired/pending/reserved IDs, disabled rules, multi-rule fan-out, policy validation rejection.
- `openrouter-client.test.js`: OAuth exchange, workspace add, mint, top-up patch, get, delete, error surfacing.
- `index.test.js`: `check-pending` statuses, pending OAuth idempotency, concurrent reservation, claim end-to-end, top-up without plaintext, reissue cooldown, admin-queued reissue, revoke admin gate.
- Slack secret handler tests in `plugins/slack/`: manifest-declared handler, opt-in gate, no matching Slack user, fail-open behavior.

### Client Tests

- Settings panel preserves management key when omitted.
- Settings panel displays Slack retention warning before enabling Slack delivery.
- Completion slot handles `no-claim`, `pending-oauth`, `minted`, and `topped-up`.
- Home/settings CTA handles pending OAuth and pending reissue.
- Admin profile slot displays "Queue reissue" and never reveals plaintext.

### Manual Smoke

- Configure plugin with a real OpenRouter management key and workspace.
- Complete a lesson with `lesson-count: 1` active.
- Walk through OAuth.
- Verify first key works against `https://openrouter.ai/api/v1/chat/completions`.
- Complete another qualifying rule and verify top-up does not rotate key if OpenRouter supports patch.
- Enable Slack delivery and verify DM arrives.
- Reissue from Settings and verify cooldown blocks a second learner-initiated reissue.
- Queue reissue as admin and verify learner can claim despite cooldown.

## Acceptance Criteria

- One spec file describes the current target design.
- No settings save can accidentally erase `managementKey`.
- No design language claims plaintext is absent from Slack or other external systems.
- Admins cannot directly generate or view learner plaintext keys.
- Earning more credit does not rotate an existing key when OpenRouter supports in-place top-up.
- Rule aggregation has deterministic v1 validation.
- Backfill handles rules added after first activation.
- Plugin code uses documented SDK/core APIs rather than private host internals.
- Security review accurately describes bearer-token auth and does not rely on CORS as CSRF protection.

## Open Questions

1. Can a management key add an OAuth-created learner user to a workspace if that learner is not already an organization member?
2. Does `POST /api/v1/auth/keys` require Authorization in this flow?
3. Can `PATCH /api/v1/keys/:hash` increase an existing key's limit while preserving reset/expiry policy?

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Award model | One stable key per learner, topped up in place when possible. |
| 2 | Rule shape | One rule list with `lesson-count` and `specific-lesson` triggers. |
| 3 | Rule policy | V1 requires one shared reset/expiry policy across enabled rules. |
| 4 | Reveal UX | One-time in-app reveal for plaintext-producing flows. |
| 5 | Slack delivery | Optional admin-enabled channel; off by default with retention warning. |
| 6 | Admin reissue | Queue learner-claimed reissue; admins never see plaintext. |
| 7 | Backfill | Rule-versioned pending claims only; no offline minting. |
| 8 | OpenRouter identity | Workspace-scoped keys tied to learner `user_id` if Phase 0 proves support. |
| 9 | Mint trigger | Client-initiated `POST /check-pending`; no completion semantics changes. |
| 10 | Implementation gate | Do not implement plugin until core API changes and Phase 0 spike are complete. |
