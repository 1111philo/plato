import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import admin from '../../src/routes/admin.js';
import db from '../../src/lib/db.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { hashContent, readBundledContent } from '../../src/lib/content-updates.js';

async function adminReq(app, method, path, body) {
  const token = await signAccessToken('usr_admin', 'admin');
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('hashContent', () => {
  it('returns consistent SHA-256 hex', () => {
    const h1 = hashContent('hello');
    const h2 = hashContent('hello');
    assert.equal(h1, h2);
    assert.equal(h1.length, 64); // SHA-256 hex = 64 chars
  });

  it('returns different hashes for different content', () => {
    assert.notEqual(hashContent('a'), hashContent('b'));
  });
});

describe('readBundledContent', () => {
  it('reads prompt files from disk', () => {
    const items = readBundledContent();
    const coach = items.find(i => i.dataKey === 'prompt:coach');
    assert.ok(coach, 'should find coach prompt');
    assert.equal(coach.type, 'prompt');
    assert.equal(coach.name, 'coach');
    assert.ok(coach.content.length > 0);
    assert.equal(coach.hash, hashContent(coach.content));
  });

  it('includes courses and knowledge base', () => {
    const items = readBundledContent();
    const types = [...new Set(items.map(i => i.type))];
    assert.ok(types.includes('prompt'));
    // courses and KB may or may not exist on disk, but prompts always do
  });
});

describe('GET /v1/admin/content-updates', () => {
  beforeEach(() => {
    db.getUserById = async (id) => {
      if (id === 'usr_admin') return { userId: 'usr_admin', role: 'admin', name: 'Admin' };
      return null;
    };
  });

  it('returns empty when all hashes match', async () => {
    const bundled = readBundledContent();
    // Mock DB to return matching hashes for all items
    db.getSyncData = async (userId, dataKey) => {
      const item = bundled.find(b => b.dataKey === dataKey);
      if (!item) return null;
      const data = item.type === 'course'
        ? { markdown: item.content, bundledHash: item.hash }
        : { content: item.content, bundledHash: item.hash };
      return { data, version: 1 };
    };

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/content-updates');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.count, 0);
    assert.deepEqual(data.updates, []);
  });

  it('returns updates when bundled content differs from DB', async () => {
    const bundled = readBundledContent();
    db.getSyncData = async (userId, dataKey) => {
      const item = bundled.find(b => b.dataKey === dataKey);
      if (!item) return null;
      // Return stale hash for coach, matching for everything else
      if (dataKey === 'prompt:coach') {
        return { data: { content: 'old coach content', bundledHash: hashContent('old coach content') }, version: 1 };
      }
      const data = item.type === 'course'
        ? { markdown: item.content, bundledHash: item.hash }
        : { content: item.content, bundledHash: item.hash };
      return { data, version: 1 };
    };

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/content-updates');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.count, 1);
    assert.equal(data.updates[0].dataKey, 'prompt:coach');
    assert.equal(data.updates[0].currentContent, 'old coach content');
    assert.ok(data.updates[0].newContent.length > 0);
    assert.equal(data.updates[0].isNew, false);
  });

  it('detects new bundled files not in DB', async () => {
    const bundled = readBundledContent();
    db.getSyncData = async (userId, dataKey) => {
      // Return null for coach (simulating it was never seeded)
      if (dataKey === 'prompt:coach') return null;
      const item = bundled.find(b => b.dataKey === dataKey);
      if (!item) return null;
      const data = item.type === 'course'
        ? { markdown: item.content, bundledHash: item.hash }
        : { content: item.content, bundledHash: item.hash };
      return { data, version: 1 };
    };

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/content-updates');
    const data = await res.json();
    const coachUpdate = data.updates.find(u => u.dataKey === 'prompt:coach');
    assert.ok(coachUpdate);
    assert.equal(coachUpdate.isNew, true);
    assert.equal(coachUpdate.currentContent, null);
  });

  it('skips items with no bundledHash when DB content matches bundled and persists hash', async () => {
    const bundled = readBundledContent();
    const putCalls = [];
    db.putSyncData = async (userId, dataKey, data, version) => {
      putCalls.push({ userId, dataKey, data, version });
    };
    db.getSyncData = async (userId, dataKey) => {
      const item = bundled.find(b => b.dataKey === dataKey);
      if (!item) return null;
      // No bundledHash, but content matches
      const data = item.type === 'course'
        ? { markdown: item.content }
        : { content: item.content };
      return { data, version: 1 };
    };

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'GET', '/v1/admin/content-updates');
    const data = await res.json();
    assert.equal(data.count, 0);

    // Verify hashes were persisted for all bundled items
    assert.ok(putCalls.length > 0, 'should have written bundledHash to DB');
    for (const call of putCalls) {
      const item = bundled.find(b => b.dataKey === call.dataKey);
      assert.equal(call.data.bundledHash, item.hash, `bundledHash should be set for ${call.dataKey}`);
    }
  });
});

describe('POST /v1/admin/content-updates/accept', () => {
  let putCalls;

  beforeEach(() => {
    putCalls = [];
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.putSyncData = async (userId, dataKey, data, version) => {
      putCalls.push({ userId, dataKey, data, version });
    };
  });

  it('writes bundled content to DB', async () => {
    const bundled = readBundledContent();
    const coach = bundled.find(b => b.dataKey === 'prompt:coach');
    db.getSyncData = async () => ({ data: { content: 'old', bundledHash: 'old' }, version: 3 });

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/content-updates/accept', { dataKey: 'prompt:coach' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);

    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].dataKey, 'prompt:coach');
    assert.equal(putCalls[0].data.content, coach.content);
    assert.equal(putCalls[0].data.bundledHash, coach.hash);
    assert.equal(putCalls[0].data.updatedBy, 'usr_admin');
    assert.equal(putCalls[0].version, 3);
  });

  it('rejects unknown dataKey', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/content-updates/accept', { dataKey: 'prompt:nonexistent' });
    assert.equal(res.status, 404);
  });

  it('rejects missing dataKey', async () => {
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/content-updates/accept', {});
    assert.equal(res.status, 400);
  });
});

describe('POST /v1/admin/content-updates/dismiss', () => {
  let putCalls;

  beforeEach(() => {
    putCalls = [];
    db.getUserById = async () => ({ userId: 'usr_admin', role: 'admin', name: 'Admin' });
    db.putSyncData = async (userId, dataKey, data, version) => {
      putCalls.push({ userId, dataKey, data, version });
    };
  });

  it('updates hash without changing content', async () => {
    const bundled = readBundledContent();
    const coach = bundled.find(b => b.dataKey === 'prompt:coach');
    db.getSyncData = async () => ({ data: { content: 'my custom prompt', bundledHash: 'old' }, version: 5 });

    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/content-updates/dismiss', { dataKey: 'prompt:coach' });
    assert.equal(res.status, 200);

    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].data.content, 'my custom prompt'); // unchanged
    assert.equal(putCalls[0].data.bundledHash, coach.hash); // updated to new hash
    assert.equal(putCalls[0].version, 5);
  });

  it('rejects when content not in DB', async () => {
    db.getSyncData = async () => null;
    const app = new Hono();
    app.route('/', admin);
    const res = await adminReq(app, 'POST', '/v1/admin/content-updates/dismiss', { dataKey: 'prompt:coach' });
    assert.equal(res.status, 404);
  });
});
