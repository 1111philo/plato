import { randomUUID } from 'node:crypto';
import {
  Hono,
  db,
  authenticate,
  requireAdmin,
  getUserMetaWithVersion,
  putUserMetaConditional,
  emitSecret,
  hostLogger,
} from '../../../src/lib/plugins/sdk.js';
import {
  emptyState,
  normalizeState,
  pruneStaleAwardReservations,
  pruneStaleReissueReservation,
  reserveAward,
  clearReservation,
  markReservationExternalSucceeded,
  finalizeAwardReservation,
  reserveReissue,
  markReissueExternalSucceeded,
  clearReissueReservation,
  finalizeReissue,
} from './state.js';
import { buildAward, evaluateRules, validateSharedPolicy } from './rules.js';
import { createOpenRouterClient } from './openrouter-client.js';

export const PLUGIN_ID = 'openrouter-rewards';

function jsonError(c, error, status = 400) {
  return c.json({ error: error?.message || String(error) }, status);
}

async function readSettings() {
  const item = await db.getSyncData('_system', 'plugins:activation');
  return item?.data?.[PLUGIN_ID]?.settings || {};
}

async function listCompletedLessons(userId) {
  const rows = await db.getAllSyncData(userId);
  return rows
    .filter((item) => item.dataKey?.startsWith('lessonKB:') && item.data?.status === 'completed')
    .map((item) => ({ lessonId: item.dataKey.slice('lessonKB:'.length), lessonKB: item.data }));
}

function rewardRules(settings) {
  const rules = Array.isArray(settings.rules) ? settings.rules : [];
  validateSharedPolicy(rules);
  return rules;
}

function keyNameFor(user, settings) {
  return String(settings.keyNameTemplate || 'plato:{userEmail}')
    .replaceAll('{userEmail}', user.email || user.userId)
    .replaceAll('{classroomName}', settings.classroomName || 'plato');
}

function expiresAtFor(rule, now) {
  if (!rule?.expiresAfterDays) return null;
  return new Date(now.getTime() + Number(rule.expiresAfterDays) * 24 * 60 * 60 * 1000).toISOString();
}

function hasInFlightAwardReservation(state) {
  return (state.reservations || []).some((r) => r.kind === 'award');
}

function publicState(state) {
  const s = normalizeState(state);
  return {
    keyHashSuffix: s.keyHash ? String(s.keyHash).slice(-8) : null,
    lifetimeAwarded: s.lifetimeAwarded || 0,
    firedRuleIds: s.firedRuleIds || [],
    pendingReissue: s.pendingReissue || null,
  };
}

async function saveLatest(userId, nextState, expectedVersion) {
  try {
    return await putUserMetaConditional(userId, PLUGIN_ID, nextState, expectedVersion);
  } catch (err) {
    err.status = 409;
    throw err;
  }
}

const CONDITIONAL_SAVE_ATTEMPTS = 4;

function isConflict(err) {
  return err?.status === 409;
}

function isMissingRemoteKey(err) {
  return err?.status === 404;
}

function keyHashSuffix(keyHash) {
  return keyHash ? String(keyHash).slice(-8) : null;
}

function policyError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function withRestoredAwardReservation(stateInput, fallbackReservation, reservationId, keyHash) {
  const state = normalizeState(stateInput || emptyState());
  if ((state.reservations || []).some((reservation) => reservation.id === reservationId)) return state;
  if (!fallbackReservation) return state;

  const fired = new Set(state.firedRuleIds || []);
  const alreadyFinalized = (fallbackReservation.ruleIds || []).every((ruleId) => fired.has(ruleId));
  if (alreadyFinalized) return state;

  return {
    ...state,
    reservations: [
      ...(state.reservations || []),
      {
        ...fallbackReservation,
        phase: 'external-succeeded',
        external: { ...(fallbackReservation.external || {}), keyHash },
      },
    ],
  };
}

async function persistAwardExternalSuccess(userId, {
  state,
  version,
  fallbackReservation,
  reservationId,
  keyHash,
  awardedAt,
}) {
  let workingState = normalizeState(state || emptyState());
  let expectedVersion = version;
  let lastError = null;

  for (let attempt = 0; attempt < CONDITIONAL_SAVE_ATTEMPTS; attempt += 1) {
    workingState = withRestoredAwardReservation(workingState, fallbackReservation, reservationId, keyHash);
    const reservation = (workingState.reservations || []).find((item) => item.id === reservationId);
    if (!reservation) return { state: workingState, version: expectedVersion };

    if (reservation.phase !== 'external-succeeded') {
      const marked = markReservationExternalSucceeded(workingState, reservationId, { keyHash });
      try {
        const markedWrite = await saveLatest(userId, marked, expectedVersion);
        workingState = marked;
        expectedVersion = markedWrite.version;
      } catch (err) {
        lastError = err;
        if (!isConflict(err)) throw err;
        const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
        workingState = normalizeState(latest.data || emptyState());
        expectedVersion = latest.version;
        continue;
      }
    }

    const finalState = finalizeAwardReservation(workingState, reservationId, { keyHash, awardedAt });
    try {
      const finalWrite = await saveLatest(userId, finalState, expectedVersion);
      return { state: finalState, version: finalWrite.version };
    } catch (err) {
      lastError = err;
      if (!isConflict(err)) throw err;
      const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
      workingState = normalizeState(latest.data || emptyState());
      expectedVersion = latest.version;
    }
  }

  throw lastError || policyError('Could not finalize OpenRouter award reservation', 409);
}

async function recoverExternalSucceededAwards(userId, latest, nowFn) {
  let current = { data: latest.data || emptyState(), version: latest.version };

  for (let attempt = 0; attempt < CONDITIONAL_SAVE_ATTEMPTS; attempt += 1) {
    const state = normalizeState(current.data || emptyState());
    const reservation = (state.reservations || []).find((item) => (
      item.kind === 'award' && item.phase === 'external-succeeded' && item.external?.keyHash
    ));

    if (!reservation) return { data: state, version: current.version };

    const finalized = await persistAwardExternalSuccess(userId, {
      state,
      version: current.version,
      fallbackReservation: reservation,
      reservationId: reservation.id,
      keyHash: reservation.external.keyHash,
      awardedAt: nowFn().toISOString(),
    });
    current = { data: finalized.state, version: finalized.version };
  }

  return current;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function topUpCompensationBody(currentKey, fallbackLimit) {
  const previousLimit = Number(currentKey?.limit ?? fallbackLimit);
  if (!Number.isFinite(previousLimit)) {
    throw policyError('Cannot compensate OpenRouter top-up without the previous key limit.', 500);
  }
  const body = { limit: previousLimit };
  if (hasOwn(currentKey, 'limit_reset')) body.limit_reset = currentKey.limit_reset;
  if (hasOwn(currentKey, 'expires_at')) body.expires_at = currentKey.expires_at;
  return body;
}

async function hasDurableAwardExternalMarker(userId, reservationId, keyHash) {
  const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
  const state = normalizeState(latest.data || emptyState());
  const reservation = (state.reservations || []).find((item) => item.id === reservationId);
  return reservation?.phase === 'external-succeeded' && reservation.external?.keyHash === keyHash;
}

async function clearReservedAwardReservation(userId, reservationId) {
  const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
  const state = normalizeState(latest.data || emptyState());
  const reservation = (state.reservations || []).find((item) => item.id === reservationId);
  if (!reservation || reservation.phase === 'external-succeeded') return;
  await saveLatest(userId, clearReservation(state, reservationId), latest.version);
}

async function compensateAwardExternalSuccess(userId, {
  client,
  reservationId,
  compensation,
}) {
  if (!compensation) return false;

  if (compensation.kind === 'mint') {
    await retireKeyRequired(client, compensation.keyHash);
  } else if (compensation.kind === 'top-up') {
    await client.patchKey(compensation.keyHash, compensation.body);
  } else {
    return false;
  }

  await clearReservedAwardReservation(userId, reservationId);
  return true;
}

function assertReissueAllowed(state, settings, nowDate) {
  if (state.pendingReissue?.reason === 'admin-requested') return;

  const cooldownHours = Number(settings.reissueCooldownHours ?? 24);
  const lastReissueAt = state.lastReissueAt ? new Date(state.lastReissueAt).getTime() : null;
  if (cooldownHours > 0 && lastReissueAt && !Number.isNaN(lastReissueAt)) {
    const elapsed = nowDate.getTime() - lastReissueAt;
    const required = cooldownHours * 60 * 60 * 1000;
    if (elapsed < required) {
      throw policyError('Key reissue is still on cooldown.', 429);
    }
  }
}

function withRestoredReissueReservation(stateInput, fallbackReservation) {
  const state = normalizeState(stateInput || emptyState());
  if (state.reissueReservation || !fallbackReservation) return state;
  if (state.keyHash !== fallbackReservation.oldKeyHash) return state;
  return {
    ...state,
    reissueReservation: fallbackReservation,
  };
}

async function persistReissueExternalSuccess(userId, {
  state,
  version,
  fallbackReservation,
  newKeyHash,
  externalSucceededAt,
}) {
  let workingState = normalizeState(state || emptyState());
  let expectedVersion = version;
  let lastError = null;

  for (let attempt = 0; attempt < CONDITIONAL_SAVE_ATTEMPTS; attempt += 1) {
    workingState = withRestoredReissueReservation(workingState, fallbackReservation);
    if (!workingState.reissueReservation) return { state: workingState, version: expectedVersion };

    const marked = markReissueExternalSucceeded(workingState, { keyHash: newKeyHash, externalSucceededAt });
    try {
      const write = await saveLatest(userId, marked, expectedVersion);
      return { state: marked, version: write.version };
    } catch (err) {
      lastError = err;
      if (!isConflict(err)) throw err;
      const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
      workingState = normalizeState(latest.data || emptyState());
      expectedVersion = latest.version;
    }
  }

  throw lastError || policyError('Could not persist OpenRouter reissue reservation', 409);
}

async function retireKeyRequired(client, keyHash) {
  if (!keyHash) return null;
  try {
    return await client.deleteKey(keyHash);
  } catch (err) {
    if (isMissingRemoteKey(err)) return null;
    try {
      return await client.disableKey(keyHash);
    } catch {
      throw err;
    }
  }
}

async function clearReservedReissueReservation(userId, reservationId) {
  const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
  const state = normalizeState(latest.data || emptyState());
  if (state.reissueReservation?.id !== reservationId || state.reissueReservation.phase === 'external-succeeded') return;
  await saveLatest(userId, clearReissueReservation(state, reservationId), latest.version);
}

function stateWithoutRetiredKey(stateInput, retiredKeyHash) {
  const state = normalizeState(stateInput || emptyState());
  let next = state;
  if (state.keyHash === retiredKeyHash) {
    next = { ...next, keyHash: null, pendingReissue: null };
  }
  if (state.reissueReservation?.newKeyHash === retiredKeyHash) {
    next = { ...next, reissueReservation: null, pendingReissue: null };
  }
  return next;
}

async function persistRetiredKeyProgress(userId, current, retiredKeyHash) {
  let workingState = normalizeState(current.data || emptyState());
  let expectedVersion = current.version;
  let lastError = null;

  for (let attempt = 0; attempt < CONDITIONAL_SAVE_ATTEMPTS; attempt += 1) {
    const nextState = stateWithoutRetiredKey(workingState, retiredKeyHash);
    if (nextState === workingState) return { data: workingState, version: expectedVersion };

    try {
      const write = await saveLatest(userId, nextState, expectedVersion);
      return { data: nextState, version: write.version };
    } catch (err) {
      lastError = err;
      if (!isConflict(err)) throw err;
      const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
      workingState = normalizeState(latest.data || emptyState());
      expectedVersion = latest.version;
    }
  }

  throw lastError || policyError('Could not persist OpenRouter revoke progress', 409);
}

async function finalizeReissueCanonical(userId, {
  state,
  version,
  fallbackReservation,
  reissuedAt,
}) {
  let workingState = normalizeState(state || emptyState());
  let expectedVersion = version;
  let lastError = null;

  for (let attempt = 0; attempt < CONDITIONAL_SAVE_ATTEMPTS; attempt += 1) {
    workingState = withRestoredReissueReservation(workingState, fallbackReservation);
    const reservation = workingState.reissueReservation;
    if (!reservation) return { state: workingState, version: expectedVersion };
    if (reservation.phase !== 'external-succeeded' || !reservation.newKeyHash) {
      throw policyError('Reissue reservation is not ready to finalize.', 409);
    }

    const finalState = finalizeReissue(workingState, {
      keyHash: reservation.newKeyHash,
      reissuedAt,
    });

    try {
      const write = await saveLatest(userId, finalState, expectedVersion);
      return { state: finalState, version: write.version };
    } catch (err) {
      lastError = err;
      if (!isConflict(err)) throw err;
      const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
      workingState = normalizeState(latest.data || emptyState());
      expectedVersion = latest.version;
    }
  }

  throw lastError || policyError('Could not finalize OpenRouter reissue reservation', 409);
}

export function createRoutes({
  createClient = createOpenRouterClient,
  uuid = randomUUID,
  now = () => new Date(),
} = {}) {
  const routes = new Hono();

  routes.post('/check-pending', authenticate, async (c) => {
    const user = c.get('user');
    const { lessonId } = await c.req.json().catch(() => ({}));
    const settings = await readSettings();
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    const recovered = await recoverExternalSucceededAwards(user.userId, latest, now);
    const state = pruneStaleAwardReservations(normalizeState(recovered.data || emptyState()), { now: now() });

    if (hasInFlightAwardReservation(state)) {
      return c.json({ status: 'processing' }, 202);
    }

    const completions = await listCompletedLessons(user.userId);
    let matched;
    try {
      matched = evaluateRules(rewardRules(settings), state, completions, lessonId);
    } catch (err) {
      return jsonError(c, err, 400);
    }
    if (matched.length === 0) return c.json({ status: 'no-claim' });

    const client = createClient({ managementKey: settings.managementKey });
    const amount = matched.reduce((sum, rule) => sum + Number(rule.creditAmount || 0), 0);
    let awardState = state;
    let currentKey = null;
    if (state.keyHash) {
      try {
        currentKey = await client.getKey(state.keyHash);
      } catch (err) {
        if (!isMissingRemoteKey(err)) throw err;
        awardState = { ...state, keyHash: null };
      }
    }
    const targetLimit = Number(currentKey?.limit || 0) + amount;
    const award = buildAward(matched, { targetLimit });
    const reservationId = uuid();
    const createdAt = now().toISOString();
    const reserved = reserveAward(awardState, matched, { ...award, reservationId, createdAt });

    let writeResult;
    try {
      writeResult = await saveLatest(user.userId, reserved, recovered.version);
    } catch (err) {
      return jsonError(c, err, err.status || 409);
    }

    let externalSucceeded = false;
    let externalKeyHash = null;
    let awardCompensation = null;
    const awardReservation = reserved.reservations.find((reservation) => reservation.id === reservationId);
    try {
      if (reserved.keyHash) {
        awardCompensation = {
          kind: 'top-up',
          keyHash: reserved.keyHash,
          body: topUpCompensationBody(currentKey, targetLimit - award.amount),
        };
        const topUp = await client.patchKey(reserved.keyHash, {
          limit: targetLimit,
          limit_reset: award.limitReset,
          expires_at: expiresAtFor(matched[0], now()),
        });
        externalSucceeded = true;
        externalKeyHash = reserved.keyHash;
        const finalized = await persistAwardExternalSuccess(user.userId, {
          state: reserved,
          version: writeResult.version,
          fallbackReservation: awardReservation,
          reservationId,
          keyHash: reserved.keyHash,
          awardedAt: now().toISOString(),
        });
        return c.json({
          status: 'topped-up',
          addedCredit: award.amount,
          lifetimeAwarded: finalized.state.lifetimeAwarded,
          limit: topUp.limit,
        });
      }

      const minted = await client.createKey({
        ...(settings.workspaceId ? { workspace_id: settings.workspaceId } : {}),
        name: keyNameFor(user, settings),
        limit: award.targetLimit,
        limit_reset: award.limitReset,
        expires_at: expiresAtFor(matched[0], now()),
      });
      externalSucceeded = true;
      externalKeyHash = minted.hash;
      awardCompensation = { kind: 'mint', keyHash: minted.hash };
      const finalized = await persistAwardExternalSuccess(user.userId, {
        state: reserved,
        version: writeResult.version,
        fallbackReservation: awardReservation,
        reservationId,
        keyHash: minted.hash,
        awardedAt: now().toISOString(),
      });

      if (settings.delivery?.slackDmEnabled === true) {
        await emitSecret('openrouter-rewards.keyAwarded', 'slack', {
          userId: user.userId,
          userEmail: user.email,
          plaintext: minted.plaintext,
          keyHash: minted.hash,
          slackDmAllowed: true,
        });
      }

      return c.json({ status: 'minted', plaintext: minted.plaintext, lifetimeAwarded: finalized.state.lifetimeAwarded, limit: minted.limit });
    } catch (err) {
      hostLogger.error('openrouter_mint_failed', {
        userId: user.userId,
        status: err.status || 500,
        error: err?.message || String(err),
        topUp: Boolean(reserved.keyHash),
        externalSucceeded,
      });
      if (externalSucceeded && externalKeyHash) {
        await persistAwardExternalSuccess(user.userId, {
          state: reserved,
          version: writeResult.version,
          fallbackReservation: awardReservation,
          reservationId,
          keyHash: externalKeyHash,
          awardedAt: now().toISOString(),
        }).catch(async (recoveryErr) => {
          hostLogger.error('openrouter_award_recovery_failed', {
            userId: user.userId,
            reservationId,
            error: recoveryErr?.message || String(recoveryErr),
          });
          const durableMarker = await hasDurableAwardExternalMarker(user.userId, reservationId, externalKeyHash)
            .catch(() => false);
          if (durableMarker) return;

          await compensateAwardExternalSuccess(user.userId, {
            client,
            reservationId,
            compensation: awardCompensation,
          }).then((compensated) => {
            if (!compensated) return;
            hostLogger.warn('openrouter_award_compensated', {
              userId: user.userId,
              reservationId,
              keyHashSuffix: keyHashSuffix(externalKeyHash),
            });
          }).catch((compensationErr) => {
            hostLogger.error('openrouter_award_compensation_failed', {
              userId: user.userId,
              reservationId,
              keyHashSuffix: keyHashSuffix(externalKeyHash),
              error: compensationErr?.message || String(compensationErr),
            });
          });
        });
      }
      if (!externalSucceeded) {
        const retry = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
        await putUserMetaConditional(user.userId, PLUGIN_ID, clearReservation(retry.data, reservationId), retry.version)
          .catch(() => {});
      }
      return jsonError(c, err, err.status || 500);
    }
  });

  routes.get('/status', authenticate, async (c) => {
    const user = c.get('user');
    const settings = await readSettings();
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    const recovered = await recoverExternalSucceededAwards(user.userId, latest, now);
    const state = pruneStaleAwardReservations(normalizeState(recovered.data || emptyState()), { now: now() });
    const base = publicState(state);

    // While an award reservation is in flight, suppress availableReward — the
    // /check-pending caller is the source of truth for that ongoing operation.
    if (hasInFlightAwardReservation(state)) {
      return c.json({ ...base, availableReward: null });
    }

    let availableReward = null;
    try {
      const completions = await listCompletedLessons(user.userId);
      const matched = evaluateRules(rewardRules(settings), state, completions);
      if (matched.length > 0) {
        const accumulatedAmount = matched.reduce((sum, rule) => sum + Number(rule.creditAmount || 0), 0);
        availableReward = { accumulatedAmount, ruleIds: matched.map((rule) => rule.id) };
      }
    } catch {
      // A misconfigured rule set must not break /status. The Claim button hidden is
      // strictly safer than a 500.
    }
    return c.json({ ...base, availableReward });
  });

  routes.post('/reissue', authenticate, async (c) => {
    const user = c.get('user');
    const settings = await readSettings();
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    const state = pruneStaleReissueReservation(normalizeState(latest.data || emptyState()), { now: now() });
    if (state.reissueReservation?.phase === 'reserved') return c.json({ status: 'processing' }, 202);
    const activeOldKeyHash = state.reissueReservation?.oldKeyHash || state.keyHash;
    if (!activeOldKeyHash) return c.json({ error: 'No key to reissue' }, 400);
    const client = createClient({ managementKey: settings.managementKey });
    let reservationId = null;
    let replacementPersisted = state.reissueReservation?.phase === 'external-succeeded';
    try {
      if (state.reissueReservation?.phase === 'external-succeeded') {
        const reservation = state.reissueReservation;
        if (state.keyHash !== reservation.oldKeyHash) {
          return c.json({ error: 'No key to reissue' }, 400);
        }
        const remainingCredit = state.reissueReservation.remainingCredit ?? null;
        await finalizeReissueCanonical(user.userId, {
          state,
          version: latest.version,
          fallbackReservation: reservation,
          reissuedAt: now().toISOString(),
        });
        let oldKeyRetirementPending = false;
        await retireKeyRequired(client, reservation.oldKeyHash).catch((err) => {
          oldKeyRetirementPending = true;
          hostLogger.warn('openrouter_old_key_delete_failed', {
            error: err?.message || String(err),
            reservationId: reservation.id,
            oldKeyHashSuffix: keyHashSuffix(reservation.oldKeyHash),
            newKeyHashSuffix: keyHashSuffix(reservation.newKeyHash),
          });
        });
        return c.json({
          status: 'reissued',
          plaintext: null,
          limit: remainingCredit,
          revealUnavailable: true,
          ...(oldKeyRetirementPending ? { oldKeyRetirementPending: true } : {}),
        });
      }

      assertReissueAllowed(state, settings, now());

      const existing = await client.getKey(activeOldKeyHash);
      const remainingCredit = Math.max(0, Number(existing.limit_remaining ?? (existing.limit - (existing.usage || 0))));
      reservationId = uuid();
      const reserved = reserveReissue(state, { reservationId, oldKeyHash: activeOldKeyHash, remainingCredit, createdAt: now().toISOString() });
      const reserveWrite = await saveLatest(user.userId, reserved, latest.version);
      const replacement = await client.createKey({
        ...(settings.workspaceId ? { workspace_id: settings.workspaceId } : {}),
        name: keyNameFor(user, settings),
        limit: remainingCredit,
      });
      const external = await persistReissueExternalSuccess(user.userId, {
        state: reserved,
        version: reserveWrite.version,
        fallbackReservation: reserved.reissueReservation,
        newKeyHash: replacement.hash,
        externalSucceededAt: now().toISOString(),
      }).catch(async (err) => {
        let replacementRetired = false;
        await retireKeyRequired(client, replacement.hash).then(() => {
          replacementRetired = true;
        }).catch((deleteErr) => {
          hostLogger.error('openrouter_reissue_replacement_cleanup_failed', {
            error: deleteErr?.message || String(deleteErr),
            keyHashSuffix: keyHashSuffix(replacement.hash),
            reservationId,
          });
        });
        if (!replacementRetired) {
          replacementPersisted = true;
          await clearReservedReissueReservation(user.userId, reservationId).catch((cleanupErr) => {
            hostLogger.warn('openrouter_reissue_reservation_cleanup_failed', {
              error: cleanupErr?.message || String(cleanupErr),
              reservationId,
            });
          });
        }
        throw err;
      });
      replacementPersisted = true;
      if (!external.state.reissueReservation) {
        let replacementRetired = false;
        await retireKeyRequired(client, replacement.hash).then(() => {
          replacementRetired = true;
        }).catch((deleteErr) => {
          hostLogger.error('openrouter_reissue_replacement_cleanup_failed', {
            error: deleteErr?.message || String(deleteErr),
            keyHashSuffix: keyHashSuffix(replacement.hash),
            reservationId,
          });
        });
        if (replacementRetired) replacementPersisted = false;
        throw policyError('Reissue was canceled before finalization.', 409);
      }
      try {
        await finalizeReissueCanonical(user.userId, {
          state: external.state,
          version: external.version,
          fallbackReservation: external.state.reissueReservation,
          reissuedAt: now().toISOString(),
        });
      } catch (err) {
        hostLogger.warn('openrouter_reissue_finalization_pending', {
          error: err?.message || String(err),
          reservationId,
          oldKeyHashSuffix: keyHashSuffix(activeOldKeyHash),
          newKeyHashSuffix: keyHashSuffix(replacement.hash),
        });
        return c.json({
          status: 'pending-finalization',
          plaintext: replacement.plaintext,
          limit: remainingCredit,
          pendingFinalization: true,
        }, 202);
      }
      let oldKeyRetirementPending = false;
      await retireKeyRequired(client, activeOldKeyHash).catch((err) => {
        oldKeyRetirementPending = true;
        hostLogger.warn('openrouter_old_key_delete_failed', {
          error: err?.message || String(err),
          reservationId,
          oldKeyHashSuffix: keyHashSuffix(activeOldKeyHash),
          newKeyHashSuffix: keyHashSuffix(replacement.hash),
        });
      });
      return c.json({
        status: 'reissued',
        plaintext: replacement.plaintext,
        limit: remainingCredit,
        ...(oldKeyRetirementPending ? { oldKeyRetirementPending: true } : {}),
      });
    } catch (err) {
      if (reservationId && !replacementPersisted) {
        await clearReservedReissueReservation(user.userId, reservationId).catch((cleanupErr) => {
          hostLogger.warn('openrouter_reissue_reservation_cleanup_failed', {
            error: cleanupErr?.message || String(cleanupErr),
            reservationId,
          });
        });
      }
      return jsonError(c, err, err.status || 500);
    }
  });

  routes.post('/admin/test', authenticate, requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const settings = { ...(await readSettings()), ...body };
    const client = createClient({ managementKey: settings.managementKey });
    try {
      const keys = await client.listKeys();
      return c.json({ ok: true, keyCount: Array.isArray(keys) ? keys.length : null });
    } catch (err) {
      return jsonError(c, err, err.status || 400);
    }
  });

  routes.get('/admin/status/:userId', authenticate, requireAdmin, async (c) => {
    const latest = await getUserMetaWithVersion(c.req.param('userId'), PLUGIN_ID);
    return c.json(publicState(latest.data));
  });

  routes.post('/admin/reissue-request/:userId', authenticate, requireAdmin, async (c) => {
    const userId = c.req.param('userId');
    const admin = c.get('user');
    const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
    const state = normalizeState(latest.data || emptyState());
    const next = {
      ...state,
      pendingReissue: {
        requestedAt: now().toISOString(),
        requestedBy: admin.userId,
        reason: 'admin-requested',
      },
    };
    await saveLatest(userId, next, latest.version);
    return c.json({ ok: true });
  });

  routes.post('/admin/revoke/:userId', authenticate, requireAdmin, async (c) => {
    const userId = c.req.param('userId');
    const settings = await readSettings();
    const latest = await getUserMetaWithVersion(userId, PLUGIN_ID);
    const state = normalizeState(latest.data || emptyState());
    const client = createClient({ managementKey: settings.managementKey });
    const hashesToRetire = [
      state.keyHash,
      state.reissueReservation?.phase === 'external-succeeded' ? state.reissueReservation.newKeyHash : null,
    ].filter(Boolean);
    let revokeState = state;
    let revokeVersion = latest.version;
    const failures = [];

    for (const keyHash of [...new Set(hashesToRetire)]) {
      try {
        await retireKeyRequired(client, keyHash);
        const progress = await persistRetiredKeyProgress(userId, { data: revokeState, version: revokeVersion }, keyHash);
        revokeState = progress.data;
        revokeVersion = progress.version;
      } catch (err) {
        hostLogger.warn('openrouter_revoke_failed', { error: err?.message || String(err), keyHashSuffix: keyHashSuffix(keyHash) });
        failures.push(err);
      }
    }
    if (failures.length > 0) return jsonError(c, failures[0], failures[0].status || 502);
    await saveLatest(userId, { ...revokeState, keyHash: null, pendingReissue: null, reissueReservation: null }, revokeVersion);
    return c.json({ ok: true });
  });

  routes.post('/admin/backfill', authenticate, requireAdmin, async (c) => {
    return c.json({ ok: true, queued: false });
  });

  return routes;
}

export default {
  routes: createRoutes(),
};
