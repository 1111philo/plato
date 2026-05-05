# OpenRouter Rewards Plugin - Design

**Status:** Implemented design, pending production OpenRouter smoke test
**Date:** 2026-05-05
**Author:** brainstormed with Henry Perkins
**Repo:** plato

## Summary

A new plato plugin, `plugins/openrouter-rewards/`, issues OpenRouter API keys to learners as configurable lesson-completion rewards. Admins define reward rules such as "after N lessons" or "after a specific lesson." When a learner satisfies a rule, plato synchronously uses the classroom's write-only OpenRouter management key to mint a workspace-scoped key, or tops up the learner's existing key when one is still present.

The target design satisfies the original ask with one external dependency: OpenRouter must support creating and managing classroom workspace keys from the management key without learner OAuth or callback routing.

- Provision keys after completing X lessons or after a specific lesson.
- Display the key in plato once when plaintext exists.
- Optionally DM the learner through Slack if the admin explicitly enables Slack key delivery.

## OpenRouter API Assumptions

This implementation uses OpenRouter's management-key API directly:

- `POST /api/v1/keys` can create a key scoped to the configured `workspace_id`.
- `GET /api/v1/keys/:hash` can read an existing key before top-up or reissue.
- `PATCH /api/v1/keys/:hash` can increase an existing key limit and update reset/expiry policy.
- `DELETE /api/v1/keys/:hash` or a disabling `PATCH` can retire replaced keys.

A production smoke test must verify these calls with a non-production classroom workspace before enabling rewards for learners. If in-place limit increases are unsupported, replacement-key top-ups must become an explicit degraded mode with user-facing warnings.

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

- Current key hash, truncated, plus lifetime awarded and rules fired count.
- Active key policy.
- Pending reward processing and pending reissue indicators.
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
       { status: 'processing' }
```

Behavior by response:

- `no-claim`: render nothing.
- `topped-up`: show a non-secret confirmation that the learner's existing key limit increased.
- `minted`: render a one-time reveal modal with copy-to-clipboard and plain-English limit/reset details.
- `processing`: show a short "reward is being prepared" message while an existing reservation is recovered or completed.

Synchronous award flow:

1. Server evaluates enabled reward rules for the learner's completed lessons.
2. Server reserves matching rule IDs in plugin-owned user metadata with optimistic locking before calling OpenRouter.
3. If the learner has a stored key hash, server reads the remote key and patches its absolute limit upward. If the remote key is missing, server treats it as stale state and mints a replacement key.
4. If the learner has no current key, server creates a new workspace-scoped key with the configured policy.
5. Server persists non-secret final state, returns plaintext only when a new key was minted, and optionally emits a targeted Slack secret event.
6. Reveal modal shows newly minted plaintext once.

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
    openrouter-client.js - management-key key CRUD
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

Reservations make the rule-award and OpenRouter side-effect boundary idempotent. `evaluateRules` treats `firedRuleIds` and `reservations[*].ruleIds` as unavailable so repeated completion UI mounts cannot accumulate the same rule twice. Reservation phases are `reserved` before an OpenRouter mutation and `external-succeeded` after the mutation succeeds but before final state persistence completes.

### Plaintext Invariant

plato never stores plaintext OpenRouter keys at rest. Plaintext exists only in:

- The HTTP response body of `POST /check-pending` when first minting a key.
- The HTTP response body of `POST /reissue`.
- The targeted in-process secret event payload sent to a manifest-declared handler such as Slack.

OpenRouter Rewards never emits plaintext on the open plugin hook bus. Public/open events may include non-secret delivery summaries such as `{ userId, keyHashSuffix, deliveryAttemptId, status }`. If Slack delivery is enabled, Slack may store the API key in Slack message history according to the classroom's Slack retention policy. The invariant is about plato storage, not external systems.

## OpenRouter API Contract

### Endpoints Used

All OpenRouter calls use `Authorization: Bearer <managementKey>`.

| Method | Path | Purpose | Body |
|---|---|---|---|
| POST | `/api/v1/keys` | Mint key | `{ name, workspace_id, limit, limit_reset, expires_at }` -> `{ key, data: { hash, ... } }` |
| GET | `/api/v1/keys/:hash` | Read usage before reissue/top-up | `{ data: { limit, usage, limit_remaining, ... } }` |
| PATCH | `/api/v1/keys/:hash` | Top up or update key | `{ limit, disabled, name, limit_reset, expires_at }` |
| DELETE | `/api/v1/keys/:hash` | Delete old key after replacement | none |

The plaintext `key` returned from `POST /api/v1/keys` is shown once to the learner and optionally sent through a targeted Slack secret event. The plugin stores only the returned key hash and non-secret metadata.

## Rule Evaluation

### Settings Validation

V1 supports one active key bucket per learner. Therefore all enabled rules must share the same `limitReset` and `expiresAfterDays` values.

If the admin tries to save incompatible rules, reject with:

> All OpenRouter reward rules must use the same reset cadence and expiry in this version. Split-key rewards are not supported yet.

This avoids surprising aggregation behavior and preserves the one-key-per-learner design.

### Pure Evaluator

```js
function evaluateRules(rules, state, completions, justCompletedLessonId) {
  const firedOrReserved = new Set([
    ...(state.firedRuleIds ?? []),
    ...((state.reservations ?? []).flatMap((r) => r.ruleIds ?? [])),
  ]);

  return rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (firedOrReserved.has(rule.id)) return false;
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

- If an award reservation exists with phase `reserved` or `external-succeeded`, return `processing` and do not create another reservation.
- If settings validation fails, return 400 before reserving or calling OpenRouter.
- Only call `clearReservation` for failures that happen before any OpenRouter mutation succeeds.
- After an OpenRouter mutation succeeds, retry finalization from latest metadata. If persistence remains unavailable, run the documented compensation path instead of clearing the reservation.

```js
async function checkPending({ userId, lessonId }) {
  const settings = await readPluginSettings();
  const { data: state, version } = await getUserMetaWithVersion(userId, 'openrouter-rewards');
  const current = state ?? emptyState();

  if ((current.reservations || []).some((r) => r.kind === 'award')) {
    return { status: 'processing' };
  }

  const completions = await listCompletedLessons(userId);
  const matched = evaluateRules(rewardRules(settings), current, completions, lessonId);

  if (matched.length === 0) return { status: 'no-claim' };

  const client = createOpenRouterClient({ managementKey: settings.managementKey });
  const amount = matched.reduce((sum, rule) => sum + Number(rule.creditAmount || 0), 0);
  let awardState = current;
  let currentKey = null;
  if (current.keyHash) {
    try {
      currentKey = await client.getKey(current.keyHash);
    } catch (err) {
      if (err.status !== 404) throw err;
      awardState = { ...current, keyHash: null };
    }
  }

  const award = buildAward(matched, { targetLimit: Number(currentKey?.limit || 0) + amount });
  const reservationId = crypto.randomUUID();
  const reserved = reserveAward(awardState, matched, award, reservationId);
  await putUserMetaConditional(userId, 'openrouter-rewards', reserved, version);

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

    const minted = await mintKey(award, settings);
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

- On first activation, do not mint keys or create hidden reward state.
- Do not mint keys or send Slack DMs during backfill.
- When rules change, settings UI shows "Rules changed. Run backfill to award learners who already qualify."
- Admin can run `POST /admin/backfill` for the current `rulesVersion`; v1 may return a no-op response until a queued backfill worker exists.
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
- Reserved reissue reservations older than the reservation TTL are treated as abandoned before returning `processing`, because no OpenRouter mutation is known to have succeeded yet.
- If a previous attempt already persisted `external-succeeded` but the HTTP response was lost, a retry finalizes from the durable replacement hash and returns `revealUnavailable: true` without plaintext. Admins can queue another reissue if the learner needs a newly revealable key; that mints a fresh replacement key and leaves the previous plaintext path unrecoverable.

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
- When multiple hashes are in play, persists each successful retirement before attempting the next one. If a later retirement fails, the route returns an error but already-retired hashes are no longer shown as active in plato state.
- Appends `{ revokedAt, revokedBy }` to audit state.
- Writes host audit log.

## API Surface

### Learner Routes

- `POST /v1/plugins/openrouter-rewards/check-pending`: returns `no-claim`, `processing`, `minted`, or `topped-up`.
- `GET /v1/plugins/openrouter-rewards/status`: returns non-secret state, top-up history, current key hash suffix, active policy, available reward summary, and pending reissue.
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
| Stored key hash no longer exists in OpenRouter | Treat the hash as stale, mint a replacement key, and overwrite `state.keyHash` during finalization so the learner is not stuck. |
| Existing key top-up unsupported | Use degraded replacement-key mode only if Phase 0 documented this limitation and UI warns learner. |
| Duplicate completion UI mounts | Second request sees rule IDs in `firedRuleIds` or `reservations` and returns `processing` or `no-claim` without creating a duplicate reservation. |
| Concurrent `check-pending` | First conditional metadata write wins. Loser re-reads and does not mint/top-up duplicate credit. |
| OpenRouter key created but final state write fails | Retry finalization from latest state using `reservationId`. If bounded retries fail, compensate by disabling the created key and logging `openrouter_created_key_compensated`; if compensation fails, log `openrouter_orphan_key_created` for admin cleanup. Never return plaintext until final state is persisted. |
| Reissue replacement key created but reservation persistence fails | Attempt to delete or disable the replacement key. If cleanup also fails, clear the reserved reissue reservation so the learner is not stuck in perpetual `processing`; the orphaned OpenRouter key is an admin cleanup item. |
| Admin revoke partially fails | Continue attempting remaining key retirements. Persist each successful retirement so already-dead OpenRouter hashes are removed from plato state before returning the failure. |
| Slack DM fails | Log and record `deliveryAttempts`; in-app reveal remains source of truth. |
| Reveal modal closed before copy | Learner can reissue from Settings; cooldown applies unless admin queued it. |

## Security Review

- **Management key:** `writeOnly: true` strips it from admin and learner plugin responses. Server routes read it only from persisted plugin settings. Never log it.
- **Plaintext keys:** plato never stores plaintext at rest and never sends plaintext over the open plugin hook bus. Plaintext leaves the OpenRouter plugin only in authenticated HTTP responses and targeted secret events.
- **Slack delivery:** disabled by default and guarded by admin warning.
- **Admin reissue:** admins queue reissue; they cannot generate or view plaintext.
- **Workspace validation:** settings save/test verifies configured workspace belongs to the management key.
- **Workspace-scoped keys:** key creation includes the configured workspace ID when present. No silent fallback to learner personal keys.
- **Learner cannot escalate:** all routes authenticate; learners can only act on their own state. Admin routes require `requireAdmin`.
- **CSRF:** plugin routes require bearer JWT in the `Authorization` header. plato does not use ambient auth cookies, so cross-site forms/images cannot authenticate. Current CORS is permissive and must not be cited as the primary CSRF control.

## Testing

### Production API Smoke Test

- Create a test key with `POST /api/v1/keys { workspace_id, ... }` using a non-production management key.
- Verify whether `PATCH /api/v1/keys/:hash` can increase an existing key limit.
- Verify whether `PATCH /api/v1/keys/:hash` can preserve or change `limit_reset` and expiry fields.
- Verify whether `DELETE /api/v1/keys/:hash` or disabling with `PATCH` retires replaced keys as expected.
- Document response bodies/status codes in this spec before production enablement.

## Phase 0 API Spike Results

Date: not yet run in this implementation branch

This branch implements the plugin behind the API assumptions above, but production enablement remains gated on a real OpenRouter smoke test with a non-production classroom workspace. Before enabling rewards for learners, replace this section with observed status codes, response body notes, and decisions for:

| Call | Status | Result | Decision |
|---|---:|---|---|
| POST /api/v1/keys with workspace_id | not run | pending key-creation behavior | keep workspace-scoped management-key design or redesign |
| PATCH /api/v1/keys/:hash limit increase | not run | pending top-up behavior | keep in-place top-up or use replacement-key degraded mode |
| DELETE or disable key | not run | pending retirement behavior | keep current reissue/revoke compensation behavior or revise |

### Core Tests

- Write-only settings preservation.
- Version-aware user meta helper success and conflict paths.
- SDK secret-event exports usable from plugins without internal imports.
- New slot names validate in schema, manifest validator, SDK types, and extension-points endpoint.

### Plugin Server Tests

- `rules.test.js`: count rules, specific-lesson rules, dedup via fired/pending/reserved IDs, disabled rules, multi-rule fan-out, policy validation rejection.
- `openrouter-client.test.js`: mint, top-up patch, get, delete, error surfacing.
- `index.test.js`: `check-pending` statuses, invalid policy handling, stale remote-key replacement, concurrent reservation, top-up without plaintext, reissue cooldown, admin-queued reissue, revoke admin gate.
- Slack secret handler tests in `plugins/slack/`: manifest-declared handler, opt-in gate, no matching Slack user, fail-open behavior.

### Client Tests

- Settings panel preserves management key when omitted.
- Settings panel displays Slack retention warning before enabling Slack delivery.
- Completion slot handles `no-claim`, `processing`, `minted`, and `topped-up`.
- Home/settings CTA handles pending reissue.
- Admin profile slot displays "Queue reissue" and never reveals plaintext.

### Manual Smoke

- Configure plugin with a real OpenRouter management key and workspace.
- Complete a lesson with `lesson-count: 1` active.
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

1. Can `PATCH /api/v1/keys/:hash` increase an existing key's limit while preserving reset/expiry policy?
2. Does disabling or deleting a key have the best learner/admin recovery semantics for reissue and revoke?

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Award model | One stable key per learner, topped up in place when possible. |
| 2 | Rule shape | One rule list with `lesson-count` and `specific-lesson` triggers. |
| 3 | Rule policy | V1 requires one shared reset/expiry policy across enabled rules. |
| 4 | Reveal UX | One-time in-app reveal for plaintext-producing flows. |
| 5 | Slack delivery | Optional admin-enabled channel; off by default with retention warning. |
| 6 | Admin reissue | Queue learner-claimed reissue; admins never see plaintext. |
| 7 | Backfill | Rule-versioned no-op/queued backfill only; no offline minting. |
| 8 | OpenRouter identity | Workspace-scoped keys are created by management key without learner OAuth. |
| 9 | Mint trigger | Client-initiated `POST /check-pending`; no completion semantics changes. |
| 10 | Implementation gate | Do not enable rewards in production until core API changes are merged and OpenRouter smoke tests pass. |
