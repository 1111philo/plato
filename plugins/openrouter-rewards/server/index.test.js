import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from '../../../server/src/lib/plugins/sdk.js';
import db from '../../../server/src/lib/db.js';
import logger from '../../../server/src/lib/logger.js';
import { signAccessToken } from '../../../server/src/lib/jwt.js';
import openRouterPlugin, { createRoutes } from './index.js';
import { emptyState } from './state.js';

const PLUGIN_ID = 'openrouter-rewards';

function fakeSyncStore() {
  const store = new Map();
  let failedWrites = 0;
  const key = (userId, dataKey) => `${userId}\0${dataKey}`;
  const getSyncData = async (userId, dataKey) => store.get(key(userId, dataKey)) || null;
  const putSyncData = async (userId, dataKey, data, expectedVersion) => {
    if (failedWrites > 0) {
      failedWrites -= 1;
      const err = new Error('injected write failure');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    const k = key(userId, dataKey);
    const cur = store.get(k);
    const version = cur?.version || 0;
    if (expectedVersion !== version) {
      const err = new Error('conflict');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    const next = { data, version: version + 1 };
    store.set(k, next);
    return next;
  };
  return {
    getSyncData,
    putSyncData,
    getAllSyncData: async (userId) => [...store.entries()]
      .filter(([k]) => k.startsWith(`${userId}\0`))
      .map(([k, value]) => ({ dataKey: k.split('\0')[1], ...value })),
    set: (userId, dataKey, data, version = 1) => store.set(key(userId, dataKey), { data, version }),
    read: (userId, dataKey) => store.get(key(userId, dataKey))?.data,
    failNextPuts: (count) => { failedWrites = count; },
  };
}

async function userReq(app, method, path, body) {
  const token = await signAccessToken('usr_user', 'user');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function adminReq(app, method, path, body) {
  const token = await signAccessToken('usr_admin', 'admin');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('OpenRouter rewards routes', () => {
  let realDb;
  let store;
  let openrouter;

  beforeEach(() => {
    realDb = {
      getUserById: db.getUserById,
      getSyncData: db.getSyncData,
      putSyncData: db.putSyncData,
      getAllSyncData: db.getAllSyncData,
    };
    store = fakeSyncStore();
    store.set('_system', 'plugins:activation', {
      [PLUGIN_ID]: {
        settings: {
          managementKey: 'sk-management',
          workspaceId: 'ws_1',
          rules: [{ id: 'rule-1', name: 'First lesson', enabled: true, trigger: 'lesson-count', value: 1, creditAmount: 5, limitReset: 'monthly', expiresAfterDays: null }],
          delivery: { slackDmEnabled: false },
          keyNameTemplate: 'plato:{classroomName}:{userEmail}',
        },
      },
    });
    store.set('usr_user', 'lessonKB:lesson-a', { status: 'completed' });
    db.getUserById = async (id) => ({
      userId: id,
      email: id === 'usr_admin' ? 'admin@example.com' : 'learner@example.com',
      role: id === 'usr_admin' ? 'admin' : 'user',
    });
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.getAllSyncData = store.getAllSyncData;
    openrouter = {
      calls: [],
      getKey: async () => ({ hash: 'hash_1', limit: 10, usage: 1, limit_remaining: 9 }),
      patchKey: async (hash, body) => {
        openrouter.calls.push({ method: 'patchKey', hash, body });
        return { hash, limit: body.limit };
      },
      createKey: async (body) => {
        openrouter.calls.push({ method: 'createKey', body });
        return { hash: 'hash_new', plaintext: 'sk-or-v1-minted', limit: body.limit };
      },
      deleteKey: async (hash) => {
        openrouter.calls.push({ method: 'deleteKey', hash });
        return { ok: true };
      },
      disableKey: async (hash) => {
        openrouter.calls.push({ method: 'disableKey', hash });
        return { ok: true };
      },
      listKeys: async () => [],
    };
  });

  afterEach(() => {
    db.getUserById = realDb.getUserById;
    db.getSyncData = realDb.getSyncData;
    db.putSyncData = realDb.putSyncData;
    db.getAllSyncData = realDb.getAllSyncData;
  });

  function app() {
    const h = new Hono();
    h.route('/', createRoutes({ createClient: () => openrouter, uuid: () => 'res-1', now: () => new Date('2026-05-05T12:00:00.000Z') }));
    return h;
  }

  it('exports host-compatible server routes', () => {
    assert.equal(typeof openRouterPlugin.routes.fetch, 'function');
  });

  it('mints a new key synchronously when rules match and the user has no key yet', async () => {
    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'minted');
    assert.equal(data.plaintext, 'sk-or-v1-minted');
    assert.equal(data.lifetimeAwarded, 5);

    const create = openrouter.calls.find((call) => call.method === 'createKey');
    assert.ok(create, 'expected createKey to be called');
    assert.equal(create.body.workspace_id, 'ws_1');
    assert.equal(create.body.name, 'plato:plato:learner@example.com');
    assert.equal(create.body.limit, 5);
    assert.equal(create.body.limit_reset, 'monthly');
    // Must NOT pass creator_user_id (model-Y rewrite drops it).
    assert.equal(create.body.creator_user_id, undefined);

    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_new');
    assert.deepEqual(persisted.firedRuleIds, ['rule-1']);
    assert.equal(persisted.reservations.length, 0);
  });

  it('returns no-claim when no rules match', async () => {
    // User has already fired the only rule.
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, { ...emptyState(), firedRuleIds: ['rule-1'] });
    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'no-claim' });
    assert.equal(openrouter.calls.length, 0);
  });

  it('patches top-up to an absolute target limit when the user already has a key', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
      firedRuleIds: [],
    });

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'topped-up');
    assert.equal(data.addedCredit, 5);
    const patch = openrouter.calls.find((call) => call.method === 'patchKey');
    assert.ok(patch);
    assert.equal(patch.body.limit, 15); // currentKey.limit (10) + amount (5)
  });

  it('retires a newly minted key when award recovery state cannot be persisted', async () => {
    openrouter.createKey = async (body) => {
      openrouter.calls.push({ method: 'createKey', body });
      store.failNextPuts(8);
      return { hash: 'hash_new', plaintext: 'sk-or-v1-minted', limit: body.limit };
    };

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });

    assert.equal(res.status, 409);
    assert.ok(openrouter.calls.find((call) => call.method === 'deleteKey' && call.hash === 'hash_new'));
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, null);
    assert.equal(persisted.reservations.length, 0);
    assert.deepEqual(persisted.firedRuleIds, []);
  });

  it('rolls back a top-up when award recovery state cannot be persisted', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
      firedRuleIds: [],
    });
    openrouter.patchKey = async (hash, body) => {
      openrouter.calls.push({ method: 'patchKey', hash, body });
      if (body.limit === 15) store.failNextPuts(8);
      return { hash, limit: body.limit };
    };

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });

    assert.equal(res.status, 409);
    const patches = openrouter.calls.filter((call) => call.method === 'patchKey');
    assert.equal(patches[0].body.limit, 15);
    assert.equal(patches[1].body.limit, 10);
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_1');
    assert.equal(persisted.lifetimeAwarded, 10);
    assert.equal(persisted.reservations.length, 0);
  });

  it('returns processing 202 when an in-flight award reservation already exists', async () => {
    // Recent reservation, well within the 5-minute TTL.
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      reservations: [{
        id: 'in-flight',
        kind: 'award',
        phase: 'reserved',
        ruleIds: ['rule-1'],
        amount: 5,
        targetLimit: 5,
        createdAt: '2026-05-05T11:59:00.000Z',
      }],
    });
    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { status: 'processing' });
  });

  it('prunes stale OAuth-era reservations so a stuck user can claim again', async () => {
    // Reserved-phase award reservation older than the 5-minute TTL — typical of a
    // pre-rewrite /claim attempt that never completed because the OAuth callback
    // failed. Without pruning, /check-pending would forever return processing.
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      pendingClaim: { ruleIds: ['rule-1'], reservationIds: ['stale'], accumulatedAmount: 5, qualifiedAt: 't', claimFingerprint: 'sha256:abc' },
      oauthSessions: [{ stateHash: 'sha256:x', codeChallenge: 'c', claimFingerprint: 'sha256:abc', createdAt: 't', expiresAt: 't+10' }],
      openrouterUserId: 'or_user_legacy',
      reservations: [{
        id: 'stale',
        kind: 'award',
        phase: 'reserved',
        ruleIds: ['rule-1'],
        amount: 5,
        targetLimit: 5,
        createdAt: '2026-05-05T11:00:00.000Z', // 1h old
      }],
    });

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'minted');

    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    // Legacy fields must not be carried forward.
    assert.equal(persisted.pendingClaim, undefined);
    assert.equal(persisted.oauthSessions, undefined);
    assert.equal(persisted.openrouterUserId, undefined);
  });

  it('logs openrouter_mint_failed with non-secret context when createKey errors', async () => {
    logger._reset();
    openrouter.createKey = async () => {
      const err = new Error('upstream rejected');
      err.status = 502;
      throw err;
    };

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });
    assert.equal(res.status, 502);

    const failed = logger.recent({ level: 'error' }).find((e) => e.code === 'openrouter_mint_failed');
    assert.ok(failed, 'expected openrouter_mint_failed log entry');
    assert.equal(failed.meta.userId, 'usr_user');
    assert.equal(failed.meta.status, 502);
    assert.equal(failed.meta.topUp, false);
    assert.equal(failed.meta.externalSucceeded, false);
    assert.equal(typeof failed.meta.error, 'string');
    // Reservation must be cleared so the user can retry.
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal((persisted.reservations || []).length, 0);
  });

  it('GET /status reports availableReward for unclaimed rules', async () => {
    const res = await userReq(app(), 'GET', '/status');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.availableReward, { accumulatedAmount: 5, ruleIds: ['rule-1'] });
    assert.equal(data.keyHashSuffix, null);
    // Must not mutate state — no createKey call.
    assert.equal(openrouter.calls.length, 0);
  });

  it('GET /status returns availableReward=null when the user has fired all rules', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, { ...emptyState(), firedRuleIds: ['rule-1'] });
    const res = await userReq(app(), 'GET', '/status');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.availableReward, null);
  });

  it('GET /status suppresses availableReward while an award reservation is in flight', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      reservations: [{
        id: 'in-flight',
        kind: 'award',
        phase: 'reserved',
        ruleIds: ['rule-1'],
        amount: 5,
        targetLimit: 5,
        createdAt: '2026-05-05T11:59:00.000Z',
      }],
    });
    const res = await userReq(app(), 'GET', '/status');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.availableReward, null);
  });

  it('allows learner-initiated reissue without an admin request', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
    });

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'reissued');
    assert.equal(data.plaintext, 'sk-or-v1-minted');
    assert.equal(data.limit, 9);
    assert.ok(openrouter.calls.find((call) => call.method === 'deleteKey' && call.hash === 'hash_1'));
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_new');
    assert.equal(persisted.pendingReissue, null);
    assert.equal(persisted.reissueReservation, null);
  });

  it('applies cooldown to learner-initiated reissue', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lastReissueAt: '2026-05-05T11:30:00.000Z',
    });

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 429);
    assert.equal(openrouter.calls.find((call) => call.method === 'createKey'), undefined);
  });

  it('lets an admin-queued reissue bypass cooldown', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lastReissueAt: '2026-05-05T11:30:00.000Z',
      pendingReissue: {
        requestedAt: '2026-05-05T11:59:00.000Z',
        requestedBy: 'usr_admin',
        reason: 'admin-requested',
      },
    });

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'reissued');
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_new');
    assert.equal(persisted.pendingReissue, null);
  });

  it('keeps the replacement key canonical when old-key retirement fails', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
    });
    openrouter.deleteKey = async (hash) => {
      openrouter.calls.push({ method: 'deleteKey', hash });
      const err = new Error('delete unavailable');
      err.status = 502;
      throw err;
    };
    openrouter.disableKey = async (hash) => {
      openrouter.calls.push({ method: 'disableKey', hash });
      const err = new Error('disable unavailable');
      err.status = 502;
      throw err;
    };

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'reissued');
    assert.equal(data.plaintext, 'sk-or-v1-minted');
    assert.equal(data.oldKeyRetirementPending, true);
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_new');
    assert.equal(persisted.reissueReservation, null);
  });

  it('finalizes an external-succeeded reissue reservation on retry without plaintext', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
      reissueReservation: {
        id: 'res-existing',
        oldKeyHash: 'hash_1',
        newKeyHash: 'hash_new',
        remainingCredit: 7,
        phase: 'external-succeeded',
        createdAt: '2026-05-05T11:59:00.000Z',
        externalSucceededAt: '2026-05-05T11:59:30.000Z',
      },
    });

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'reissued');
    assert.equal(data.plaintext, null);
    assert.equal(data.revealUnavailable, true);
    assert.equal(data.limit, 7);
    assert.ok(openrouter.calls.find((call) => call.method === 'deleteKey' && call.hash === 'hash_1'));
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_new');
    assert.equal(persisted.reissueReservation, null);
  });

  it('clears a reserved reissue when replacement persistence and cleanup both fail', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
    });
    openrouter.createKey = async (body) => {
      openrouter.calls.push({ method: 'createKey', body });
      store.failNextPuts(4);
      return { hash: 'hash_new', plaintext: 'sk-or-v1-minted', limit: body.limit };
    };
    openrouter.deleteKey = async (hash) => {
      openrouter.calls.push({ method: 'deleteKey', hash });
      if (hash === 'hash_new') {
        const err = new Error('delete unavailable');
        err.status = 502;
        throw err;
      }
      return { ok: true };
    };
    openrouter.disableKey = async (hash) => {
      openrouter.calls.push({ method: 'disableKey', hash });
      if (hash === 'hash_new') {
        const err = new Error('disable unavailable');
        err.status = 502;
        throw err;
      }
      return { ok: true };
    };

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 409);
    assert.ok(openrouter.calls.find((call) => call.method === 'deleteKey' && call.hash === 'hash_new'));
    assert.ok(openrouter.calls.find((call) => call.method === 'disableKey' && call.hash === 'hash_new'));
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_1');
    assert.equal(persisted.reissueReservation, null);
  });

  it('prunes stale reserved reissue reservations before returning processing', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
      reissueReservation: {
        id: 'stale-reissue',
        oldKeyHash: 'hash_1',
        remainingCredit: 9,
        phase: 'reserved',
        createdAt: '2026-05-05T11:00:00.000Z',
      },
    });

    const res = await userReq(app(), 'POST', '/reissue');

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'reissued');
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, 'hash_new');
    assert.equal(persisted.reissueReservation, null);
  });

  it('persists admin revoke progress when a later key retirement fails', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      keyHash: 'hash_1',
      lifetimeAwarded: 10,
      reissueReservation: {
        id: 'res-existing',
        oldKeyHash: 'hash_1',
        newKeyHash: 'hash_new',
        remainingCredit: 7,
        phase: 'external-succeeded',
        createdAt: '2026-05-05T11:59:00.000Z',
        externalSucceededAt: '2026-05-05T11:59:30.000Z',
      },
    });
    openrouter.deleteKey = async (hash) => {
      openrouter.calls.push({ method: 'deleteKey', hash });
      if (hash === 'hash_new') {
        const err = new Error('delete unavailable');
        err.status = 502;
        throw err;
      }
      return { ok: true };
    };
    openrouter.disableKey = async (hash) => {
      openrouter.calls.push({ method: 'disableKey', hash });
      if (hash === 'hash_new') {
        const err = new Error('disable unavailable');
        err.status = 502;
        throw err;
      }
      return { ok: true };
    };

    const res = await adminReq(app(), 'POST', '/admin/revoke/usr_user');

    assert.equal(res.status, 502);
    assert.ok(openrouter.calls.find((call) => call.method === 'deleteKey' && call.hash === 'hash_1'));
    assert.ok(openrouter.calls.find((call) => call.method === 'deleteKey' && call.hash === 'hash_new'));
    const persisted = store.read('usr_user', `userMeta:${PLUGIN_ID}`);
    assert.equal(persisted.keyHash, null);
    assert.equal(persisted.reissueReservation.newKeyHash, 'hash_new');
  });
});
