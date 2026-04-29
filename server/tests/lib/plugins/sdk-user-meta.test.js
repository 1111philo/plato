import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import db from '../../../src/lib/db.js';
import { getUserMeta, putUserMeta, deleteUserMeta } from '../../../src/lib/plugins/sdk.js';

function fakeUserSyncStore() {
  const store = new Map();
  const k = (userId, key) => `${userId}\0${key}`;
  return {
    getSyncData: async (u, key) => store.get(k(u, key)) || null,
    putSyncData: async (u, key, data, expectedVersion) => {
      const cur = store.get(k(u, key));
      const ver = cur?.version || 0;
      if (expectedVersion !== ver) {
        const err = new Error('conflict'); err.name = 'ConditionalCheckFailedException'; throw err;
      }
      const next = { data, version: ver + 1 };
      store.set(k(u, key), next);
      return next;
    },
    deleteSyncData: async (u, key) => { store.delete(k(u, key)); },
    _peek: () => store,
  };
}

describe('plugin SDK — getUserMeta / putUserMeta / deleteUserMeta', () => {
  let store;
  beforeEach(() => {
    store = fakeUserSyncStore();
    db.getSyncData = store.getSyncData;
    db.putSyncData = store.putSyncData;
    db.deleteSyncData = store.deleteSyncData;
  });

  it('getUserMeta returns null when no record exists', async () => {
    const out = await getUserMeta('usr_x', 'demo');
    assert.equal(out, null);
  });

  it('putUserMeta then getUserMeta round-trips', async () => {
    await putUserMeta('usr_x', 'demo', { foo: 'bar' });
    const out = await getUserMeta('usr_x', 'demo');
    assert.deepEqual(out, { foo: 'bar' });
  });

  it('storage key is exactly userMeta:<pluginId>', async () => {
    await putUserMeta('usr_x', 'teacher-comments', { text: 'hi' });
    const raw = await store.getSyncData('usr_x', 'userMeta:teacher-comments');
    assert.deepEqual(raw.data, { text: 'hi' });
  });

  it('plugins are isolated from each other', async () => {
    await putUserMeta('usr_x', 'pluginA', { a: 1 });
    await putUserMeta('usr_x', 'pluginB', { b: 2 });
    assert.deepEqual(await getUserMeta('usr_x', 'pluginA'), { a: 1 });
    assert.deepEqual(await getUserMeta('usr_x', 'pluginB'), { b: 2 });
  });

  it('users are isolated within the same plugin', async () => {
    await putUserMeta('usr_x', 'demo', { value: 'X' });
    await putUserMeta('usr_y', 'demo', { value: 'Y' });
    assert.deepEqual(await getUserMeta('usr_x', 'demo'), { value: 'X' });
    assert.deepEqual(await getUserMeta('usr_y', 'demo'), { value: 'Y' });
  });

  it('putUserMeta updates an existing record', async () => {
    await putUserMeta('usr_x', 'demo', { count: 1 });
    await putUserMeta('usr_x', 'demo', { count: 2 });
    assert.deepEqual(await getUserMeta('usr_x', 'demo'), { count: 2 });
  });

  it('deleteUserMeta removes the record', async () => {
    await putUserMeta('usr_x', 'demo', { foo: 'bar' });
    await deleteUserMeta('usr_x', 'demo');
    assert.equal(await getUserMeta('usr_x', 'demo'), null);
  });

  it('rejects missing userId or pluginId', async () => {
    await assert.rejects(() => getUserMeta('', 'demo'), /required/);
    await assert.rejects(() => getUserMeta('usr_x', ''), /required/);
    await assert.rejects(() => putUserMeta('usr_x', 'demo', null), /must be an object/);
    await assert.rejects(() => putUserMeta('usr_x', 'demo', 'string'), /must be an object/);
    await assert.rejects(() => deleteUserMeta('', 'demo'), /required/);
  });
});
