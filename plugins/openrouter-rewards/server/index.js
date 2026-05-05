import { randomUUID } from 'node:crypto';
import {
  Hono,
  db,
  authenticate,
  requireAdmin,
  getUserMetaWithVersion,
  putUserMetaConditional,
  emitSecret,
  APP_URL,
  hostLogger,
} from '../../../src/lib/plugins/sdk.js';
import {
  emptyState,
  normalizeState,
  existingPendingResponse,
  reserveAward,
  clearReservation,
  markReservationExternalSucceeded,
  finalizeAwardReservation,
  reserveReissue,
  finalizeReissue,
} from './state.js';
import { buildAward, evaluateRules, validateSharedPolicy } from './rules.js';
import { buildAuthorizationUrl, buildOauthSession, consumeOauthSession } from './oauth-state.js';
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

function defaultCallbackUrl() {
  return `${APP_URL || ''}/`;
}

function isLocalhost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function resolveCallbackUrl(candidate) {
  const fallback = defaultCallbackUrl();
  if (!candidate) return fallback;

  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid OpenRouter callback URL');
  }

  const app = new URL(fallback);
  const sameOrigin = url.origin === app.origin;
  const localDev = isLocalhost(url.hostname) && isLocalhost(app.hostname);
  if (!sameOrigin && !localDev) {
    throw new Error('Invalid OpenRouter callback URL');
  }

  return url.toString();
}

function publicState(state) {
  const s = normalizeState(state);
  return {
    openrouterUserId: s.openrouterUserId,
    keyHashSuffix: s.keyHash ? String(s.keyHash).slice(-8) : null,
    lifetimeAwarded: s.lifetimeAwarded || 0,
    firedRuleIds: s.firedRuleIds || [],
    pendingClaim: s.pendingClaim ? {
      ruleIds: s.pendingClaim.ruleIds || [],
      accumulatedAmount: s.pendingClaim.accumulatedAmount || 0,
      qualifiedAt: s.pendingClaim.qualifiedAt || null,
    } : null,
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
    const state = normalizeState(latest.data || emptyState());

    const existing = existingPendingResponse(state);
    if (existing) return c.json(existing);
    if ((state.reservations || []).some((r) => r.kind === 'award')) {
      return c.json({ status: 'processing' }, 202);
    }

    const completions = await listCompletedLessons(user.userId);
    const matched = evaluateRules(rewardRules(settings), state, completions, lessonId);
    if (matched.length === 0) return c.json({ status: 'no-claim' });

    const client = createClient({ managementKey: settings.managementKey });
    const amount = matched.reduce((sum, rule) => sum + Number(rule.creditAmount || 0), 0);
    const currentKey = state.keyHash ? await client.getKey(state.keyHash) : null;
    const targetLimit = Number(currentKey?.limit || 0) + amount;
    const award = buildAward(matched, { targetLimit });
    const reservationId = uuid();
    const createdAt = now().toISOString();
    const reserved = reserveAward(state, matched, { ...award, reservationId, createdAt });

    let writeResult;
    try {
      writeResult = await saveLatest(user.userId, reserved, latest.version);
    } catch (err) {
      return jsonError(c, err, err.status || 409);
    }

    if (!reserved.openrouterUserId) {
      return c.json({
        status: 'pending-oauth',
        accumulatedAmount: reserved.pendingClaim.accumulatedAmount,
        ruleNames: matched.map((rule) => rule.name || rule.id),
      });
    }

    let externalSucceeded = false;
    try {
      if (reserved.keyHash) {
        const topUp = await client.patchKey(reserved.keyHash, {
          limit: targetLimit,
          limit_reset: award.limitReset,
          expires_at: expiresAtFor(matched[0], now()),
        });
        externalSucceeded = true;
        const afterExternal = markReservationExternalSucceeded(reserved, reservationId, { keyHash: reserved.keyHash });
        const externalWrite = await saveLatest(user.userId, afterExternal, writeResult.version);
        const finalState = finalizeAwardReservation(afterExternal, reservationId, {
          keyHash: reserved.keyHash,
          awardedAt: now().toISOString(),
        });
        await saveLatest(user.userId, finalState, externalWrite.version);
        return c.json({
          status: 'topped-up',
          addedCredit: award.amount,
          lifetimeAwarded: finalState.lifetimeAwarded,
          limit: topUp.limit,
        });
      }

      const minted = await client.createKey({
        workspace_id: settings.workspaceId,
        creator_user_id: reserved.openrouterUserId,
        name: keyNameFor(user, settings),
        limit: award.targetLimit,
        limit_reset: award.limitReset,
        expires_at: expiresAtFor(matched[0], now()),
      });
      externalSucceeded = true;
      const afterExternal = markReservationExternalSucceeded(reserved, reservationId, { keyHash: minted.hash });
      const externalWrite = await saveLatest(user.userId, afterExternal, writeResult.version);
      const finalState = finalizeAwardReservation(afterExternal, reservationId, {
        keyHash: minted.hash,
        awardedAt: now().toISOString(),
      });
      await saveLatest(user.userId, finalState, externalWrite.version);

      if (settings.delivery?.slackDmEnabled === true) {
        await emitSecret('openrouter-rewards.keyAwarded', 'slack', {
          userId: user.userId,
          userEmail: user.email,
          plaintext: minted.plaintext,
          keyHash: minted.hash,
          slackDmAllowed: true,
        });
      }

      return c.json({ status: 'minted', plaintext: minted.plaintext, lifetimeAwarded: finalState.lifetimeAwarded, limit: minted.limit });
    } catch (err) {
      if (!externalSucceeded) {
        const retry = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
        await putUserMetaConditional(user.userId, PLUGIN_ID, clearReservation(retry.data, reservationId), retry.version)
          .catch(() => {});
      }
      return jsonError(c, err, err.status || 500);
    }
  });

  routes.post('/oauth/start', authenticate, async (c) => {
    const user = c.get('user');
    const { codeChallenge, callbackUrl } = await c.req.json().catch(() => ({}));
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    const state = normalizeState(latest.data || emptyState());
    try {
      const { state: oauthState, nextState } = buildOauthSession(state, { codeChallenge, now: now() });
      await saveLatest(user.userId, nextState, latest.version);
      return c.json({
        state: oauthState,
        authorizationUrl: buildAuthorizationUrl({
          state: oauthState,
          codeChallenge,
          callbackUrl: resolveCallbackUrl(callbackUrl),
        }),
      });
    } catch (err) {
      return jsonError(c, err, err.status || 400);
    }
  });

  routes.post('/claim', authenticate, async (c) => {
    const user = c.get('user');
    const { code, state: oauthState, codeVerifier } = await c.req.json().catch(() => ({}));
    const settings = await readSettings();
    const client = createClient({ managementKey: settings.managementKey });
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    const current = normalizeState(latest.data || emptyState());
    try {
      const consumed = consumeOauthSession(current, { state: oauthState, codeVerifier, now: now() });
      const consumedWrite = await saveLatest(user.userId, consumed.nextState, latest.version);
      const oauth = await client.exchangeOAuthCode({ code, codeVerifier });
      if (settings.workspaceId && oauth.openrouterUserId) {
        await client.addWorkspaceMember(settings.workspaceId, oauth.openrouterUserId);
      }
      const pending = consumed.nextState.pendingClaim;
      if (!pending) return c.json({ status: 'no-claim' });
      const reservationId = pending.reservationIds?.[0] || uuid();
      const stateWithReservation = consumed.nextState.reservations?.some((r) => r.id === reservationId)
        ? consumed.nextState
        : reserveAward({ ...consumed.nextState, openrouterUserId: oauth.openrouterUserId }, pending.ruleIds.map((id) => ({ id })), {
            amount: pending.accumulatedAmount,
            targetLimit: pending.accumulatedAmount,
            reservationId,
            createdAt: pending.qualifiedAt || now().toISOString(),
          });
      const minted = await client.createKey({
        workspace_id: settings.workspaceId,
        creator_user_id: oauth.openrouterUserId,
        name: keyNameFor(user, settings),
        limit: pending.accumulatedAmount,
      });
      const afterExternal = markReservationExternalSucceeded(stateWithReservation, reservationId, { keyHash: minted.hash });
      const externalWrite = await saveLatest(user.userId, afterExternal, consumedWrite.version);
      const finalState = finalizeAwardReservation(afterExternal, reservationId, {
        keyHash: minted.hash,
        openrouterUserId: oauth.openrouterUserId,
        awardedAt: now().toISOString(),
      });
      await saveLatest(user.userId, finalState, externalWrite.version);
      if (settings.delivery?.slackDmEnabled === true) {
        await emitSecret('openrouter-rewards.keyAwarded', 'slack', {
          userId: user.userId,
          userEmail: user.email,
          plaintext: minted.plaintext,
          keyHash: minted.hash,
          slackDmAllowed: true,
        });
      }
      return c.json({ status: 'minted', plaintext: minted.plaintext, lifetimeAwarded: finalState.lifetimeAwarded, limit: minted.limit });
    } catch (err) {
      return jsonError(c, err, err.status || 400);
    }
  });

  routes.get('/status', authenticate, async (c) => {
    const user = c.get('user');
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    return c.json(publicState(latest.data));
  });

  routes.post('/reissue', authenticate, async (c) => {
    const user = c.get('user');
    const settings = await readSettings();
    const latest = await getUserMetaWithVersion(user.userId, PLUGIN_ID);
    const state = normalizeState(latest.data || emptyState());
    if (!state.keyHash) return c.json({ error: 'No key to reissue' }, 400);
    const client = createClient({ managementKey: settings.managementKey });
    try {
      const existing = await client.getKey(state.keyHash);
      const remainingCredit = Math.max(0, Number(existing.limit_remaining ?? (existing.limit - (existing.usage || 0))));
      const reservationId = uuid();
      const reserved = reserveReissue(state, { reservationId, oldKeyHash: state.keyHash, remainingCredit, createdAt: now().toISOString() });
      const reserveWrite = await saveLatest(user.userId, reserved, latest.version);
      const replacement = await client.createKey({
        workspace_id: settings.workspaceId,
        creator_user_id: state.openrouterUserId,
        name: keyNameFor(user, settings),
        limit: remainingCredit,
      });
      const finalState = finalizeReissue(reserved, { keyHash: replacement.hash, reissuedAt: now().toISOString() });
      await saveLatest(user.userId, finalState, reserveWrite.version);
      await client.deleteKey(state.keyHash).catch((err) => {
        hostLogger.warn('openrouter_old_key_delete_failed', { error: err?.message, keyHash: state.keyHash });
      });
      return c.json({ status: 'reissued', plaintext: replacement.plaintext, limit: remainingCredit });
    } catch (err) {
      return jsonError(c, err, err.status || 500);
    }
  });

  routes.post('/admin/test', authenticate, requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const settings = { ...(await readSettings()), ...body };
    const client = createClient({ managementKey: settings.managementKey });
    try {
      const [keys, workspaces] = await Promise.all([client.listKeys(), client.listWorkspaces()]);
      return c.json({ ok: true, keyCount: Array.isArray(keys) ? keys.length : null, workspaces });
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
    if (state.keyHash) {
      await createClient({ managementKey: settings.managementKey }).deleteKey(state.keyHash).catch(() => {});
    }
    await saveLatest(userId, { ...state, keyHash: null }, latest.version);
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
