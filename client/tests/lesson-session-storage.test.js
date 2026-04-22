import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _serverStore = new Map();
const _serverVersions = new Map();

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function guardedLessonId(key) {
  if (key.startsWith('lessonKB:')) return key.slice('lessonKB:'.length);
  if (key.startsWith('messages:')) {
    const lessonId = key.slice('messages:'.length);
    return lessonId.startsWith('create:') ? null : lessonId;
  }
  if (key.startsWith('activities:')) return key.slice('activities:'.length);
  if (key.startsWith('activityKBs:')) return key.slice('activityKBs:'.length);
  if (key.startsWith('drafts:')) return key.slice('drafts:'.length);
  return null;
}

function currentLessonSession(lessonId) {
  if (!lessonId) return null;
  return _serverStore.get(`lessonSession:${lessonId}`) || null;
}

globalThis.fetch = async (url, opts) => {
  const path = new URL(url, 'http://localhost').pathname;
  const syncMatch = path.match(/^\/v1\/sync\/(.+)/);
  if (!syncMatch) return response(404, {});

  const key = decodeURIComponent(syncMatch[1]);

  if (opts?.method === 'PUT') {
    const body = JSON.parse(opts.body);
    const lessonId = guardedLessonId(key);
    if (lessonId) {
      const session = currentLessonSession(lessonId);
      const sessionVersion = _serverVersions.get(`lessonSession:${lessonId}`) || 0;
      if (!body.guard?.lessonSessionId || !session || session.lessonSessionId !== body.guard.lessonSessionId) {
        return response(409, {
          error: 'Lesson session conflict',
          conflict: 'stale_session',
          serverVersion: sessionVersion,
          lessonSession: session,
        });
      }
    }

    const currentVersion = _serverVersions.get(key) || 0;
    if ((body.version || 0) !== currentVersion) {
      return response(409, {
        error: 'Version conflict',
        conflict: 'version',
        serverVersion: currentVersion,
      });
    }

    const newVersion = currentVersion + 1;
    _serverStore.set(key, body.data);
    _serverVersions.set(key, newVersion);
    return response(200, { version: newVersion, updatedAt: '2026-04-21T00:00:00.000Z' });
  }

  if (opts?.method === 'DELETE') {
    _serverStore.delete(key);
    _serverVersions.delete(key);
    return response(200, { ok: true });
  }

  if (_serverStore.has(key)) {
    return response(200, {
      data: _serverStore.get(key),
      version: _serverVersions.get(key) || 0,
    });
  }

  return response(404, {});
};

globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};

localStorage.setItem('plato_auth', JSON.stringify({
  accessToken: 'test-token',
  refreshToken: 'test-refresh',
}));

const {
  clearCache,
  deleteLessonProgress,
  ensureLessonSession,
  getLessonKB,
  getLessonMessages,
  getLessonSession,
  saveLessonMessages,
  updateLessonKB,
} = await import('../js/storage.js');

describe('lesson session storage', () => {
  beforeEach(() => {
    clearCache();
    _serverStore.clear();
    _serverVersions.clear();
  });

  it('rotates the lesson session on reset and rejects stale writes from an older session', async () => {
    const lessonId = 'foundation-1';
    const firstSession = await ensureLessonSession(lessonId);

    await saveLessonMessages(lessonId, [
      { role: 'assistant', content: 'First run' },
    ], { lessonSession: firstSession });

    await deleteLessonProgress(lessonId);

    const secondSession = await getLessonSession(lessonId);
    assert.notEqual(secondSession.lessonSessionId, firstSession.lessonSessionId);
    assert.equal(secondSession.generation, firstSession.generation + 1);

    await assert.rejects(
      () => saveLessonMessages(lessonId, [{ role: 'assistant', content: 'stale tab replay' }], { lessonSession: firstSession }),
      /lesson session/i
    );

    const messages = await getLessonMessages(lessonId, { preferCache: false });
    assert.deepEqual(messages, []);
  });

  it('merges new lesson messages onto the latest server history after a version conflict', async () => {
    const lessonId = 'foundation-1';
    const session = await ensureLessonSession(lessonId);

    await saveLessonMessages(lessonId, [
      { role: 'assistant', content: 'First coach message' },
    ], { lessonSession: session });

    const existing = _serverStore.get(`messages:${lessonId}`);
    _serverStore.set(`messages:${lessonId}`, [
      ...existing,
      {
        role: 'user',
        content: 'Reply from another tab',
        timestamp: 2,
        messageId: 'srv-msg-2',
        lessonSessionId: session.lessonSessionId,
        lessonSessionGeneration: session.generation,
      },
    ]);
    _serverVersions.set(`messages:${lessonId}`, 2);

    await saveLessonMessages(lessonId, [
      { role: 'assistant', content: 'Current tab reply' },
    ], { lessonSession: session });

    const messages = await getLessonMessages(lessonId, { preferCache: false });
    assert.equal(messages.length, 3);
    assert.equal(messages[0].content, 'First coach message');
    assert.equal(messages[1].content, 'Reply from another tab');
    assert.equal(messages[2].content, 'Current tab reply');
  });

  it('reapplies a lesson KB update against the latest server state after a version conflict', async () => {
    const lessonId = 'foundation-1';
    const session = await ensureLessonSession(lessonId);

    _serverStore.set(`lessonKB:${lessonId}`, {
      status: 'active',
      progress: 4,
      activitiesCompleted: 4,
      learnerPosition: 'Working',
      insights: [],
    });
    _serverVersions.set(`lessonKB:${lessonId}`, 1);

    const cached = await getLessonKB(lessonId);
    assert.equal(cached.progress, 4);

    _serverStore.set(`lessonKB:${lessonId}`, {
      status: 'active',
      progress: 9,
      activitiesCompleted: 9,
      learnerPosition: 'Nearly there',
      insights: ['close'],
    });
    _serverVersions.set(`lessonKB:${lessonId}`, 2);

    const result = await updateLessonKB(
      lessonId,
      (prev) => ({
        ...prev,
        status: 'completed',
        progress: 10,
        activitiesCompleted: (prev?.activitiesCompleted || 0) + 1,
      }),
      { lessonSession: session }
    );

    assert.equal(result.lessonKB.progress, 10);
    assert.equal(result.lessonKB.status, 'completed');
    assert.equal(result.lessonKB.activitiesCompleted, 10);

    const saved = _serverStore.get(`lessonKB:${lessonId}`);
    assert.equal(saved.progress, 10);
    assert.equal(saved.activitiesCompleted, 10);
    assert.equal(_serverVersions.get(`lessonKB:${lessonId}`), 3);
  });
});
