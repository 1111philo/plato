import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from '../../../server/src/lib/plugins/sdk.js';
import db from '../../../server/src/lib/db.js';
import { signAccessToken } from '../../../server/src/lib/jwt.js';
import openRouterPlugin, { createRoutes } from './index.js';
import { emptyState } from './state.js';

const PLUGIN_ID = 'openrouter-rewards';

function fakeSyncStore() {
  const store = new Map();
  const key = (userId, dataKey) => `${userId}\0${dataKey}`;
  const getSyncData = async (userId, dataKey) => store.get(key(userId, dataKey)) || null;
  const putSyncData = async (userId, dataKey, data, expectedVersion) => {
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
        },
      },
    });
    store.set('usr_user', 'lessonKB:lesson-a', { status: 'completed' });
    db.getUserById = async (id) => ({ userId: id, email: 'learner@example.com', role: 'user' });
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

  it('returns pending-oauth for repeated completion mounts with an existing pending claim', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      pendingClaim: {
        ruleIds: ['rule-1'],
        reservationIds: ['res-1'],
        accumulatedAmount: 5,
        qualifiedAt: '2026-05-05T12:00:00.000Z',
        claimFingerprint: 'sha256:claim',
      },
    });

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      status: 'pending-oauth',
      accumulatedAmount: 5,
      ruleIds: ['rule-1'],
    });
    assert.equal(openrouter.calls.length, 0);
  });

  it('patches top-up to an absolute target limit', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      openrouterUserId: 'user_or',
      keyHash: 'hash_1',
      firedRuleIds: [],
    });

    const res = await userReq(app(), 'POST', '/check-pending', { lessonId: 'lesson-a' });

    assert.equal(res.status, 200);
    assert.equal(openrouter.calls[0].body.limit, 15);
  });

  it('uses a validated client callback URL for local OAuth starts', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      pendingClaim: {
        ruleIds: ['rule-1'],
        reservationIds: ['res-1'],
        accumulatedAmount: 5,
        qualifiedAt: '2026-05-05T12:00:00.000Z',
        claimFingerprint: 'sha256:claim',
      },
    });

    const res = await userReq(app(), 'POST', '/oauth/start', {
      codeChallenge: 'challenge-1',
      callbackUrl: 'http://localhost:5173/settings',
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const authUrl = new URL(data.authorizationUrl);
    assert.equal(authUrl.searchParams.get('callback_url'), 'http://localhost:5173/settings');
  });

  it('rejects non-local OAuth callback URLs', async () => {
    store.set('usr_user', `userMeta:${PLUGIN_ID}`, {
      ...emptyState(),
      pendingClaim: {
        ruleIds: ['rule-1'],
        reservationIds: ['res-1'],
        accumulatedAmount: 5,
        qualifiedAt: '2026-05-05T12:00:00.000Z',
        claimFingerprint: 'sha256:claim',
      },
    });

    const res = await userReq(app(), 'POST', '/oauth/start', {
      codeChallenge: 'challenge-1',
      callbackUrl: 'https://evil.example/settings',
    });

    assert.equal(res.status, 400);
  });
});
