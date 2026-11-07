/**
 * Slack auto-invite (#379, plugins/slack/server/auto-invite.js), and the host
 * keeping a plugin's writeOnly settings when a save leaves them out.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { autoInvite, onUserCreated, needsRetry } from '../../../plugins/slack/server/auto-invite.js';

const SETTINGS = { botToken: 'xoxb-1', autoInviteEnabled: true, autoInviteChannelId: 'C1', autoInviteChannelName: 'cohort' };

function deps(overrides = {}) {
  const meta = new Map();
  const calls = { lookup: 0, invite: 0 };
  return {
    meta, calls,
    lookup: async (_t, email) => { calls.lookup++; return email === 'in@x.com' ? 'U1' : null; },
    invite: async () => { calls.invite++; },
    getMeta: async (u) => meta.get(u) || null,
    putMeta: async (u, _p, data) => { meta.set(u, data); },
    ...overrides,
  };
}

describe('Slack auto-invite', () => {
  let d;
  beforeEach(() => { d = deps(); });

  it('adds a workspace member to the channel and records it; a retry doesn’t invite twice', async () => {
    const r = await autoInvite({ userId: 'usr_1', email: 'in@x.com' }, SETTINGS, d);
    assert.deepEqual([r.status, r.channelId, r.channelName], ['invited', 'C1', 'cohort']);
    assert.equal(d.meta.get('usr_1').autoInvite.status, 'invited');
    assert.equal(await autoInvite({ userId: 'usr_1', email: 'in@x.com' }, SETTINGS, d), null);
    assert.equal(d.calls.invite, 1);
  });

  it('a new channel means a new invite', async () => {
    await autoInvite({ userId: 'usr_1', email: 'in@x.com' }, SETTINGS, d);
    await autoInvite({ userId: 'usr_1', email: 'in@x.com' }, { ...SETTINGS, autoInviteChannelId: 'C2' }, d);
    assert.equal(d.calls.invite, 2);
  });

  it('records people not in the workspace and Slack errors (retryable)', async () => {
    assert.equal((await autoInvite({ userId: 'usr_2', email: 'out@x.com' }, SETTINGS, d)).status, 'not_in_workspace');
    const failing = deps({ invite: async () => { throw Object.assign(new Error('x'), { data: { error: 'not_in_channel' } }); } });
    const r = await autoInvite({ userId: 'usr_3', email: 'in@x.com' }, SETTINGS, failing);
    assert.deepEqual([r.status, r.error], ['failed', 'not_in_channel']);
    // Retrying a failed one tries again.
    assert.equal((await autoInvite({ userId: 'usr_3', email: 'in@x.com' }, SETTINGS, { ...failing, invite: async () => {} })).status, 'invited');
  });

  it('a Slack timeout during signup is recorded as failed, and Retry all picks it up', async () => {
    const timedOut = deps({ lookup: async () => { throw Object.assign(new Error('A request error occurred: timeout of 4000ms exceeded'), { code: 'slack_webapi_request_error' }); } });
    const r = await autoInvite({ userId: 'usr_4', email: 'in@x.com' }, SETTINGS, timedOut);
    assert.equal(r.status, 'failed');
    assert.match(r.error, /timeout/);
    const meta = timedOut.meta.get('usr_4');
    assert.equal(needsRetry(meta), true);
    assert.equal(needsRetry({ autoInvite: { status: 'invited' } }), false);
    assert.equal(needsRetry(null), false, 'no attempt recorded: not part of Retry all');
    // The retry then goes through.
    assert.equal((await autoInvite({ userId: 'usr_4', email: 'in@x.com' }, SETTINGS, { ...timedOut, lookup: async () => 'U1' })).status, 'invited');
  });

  it('does nothing while off, without a channel, or without a token', async () => {
    for (const s of [{ ...SETTINGS, autoInviteEnabled: false }, { ...SETTINGS, autoInviteChannelId: '' }, { ...SETTINGS, botToken: null }]) {
      assert.equal(await autoInvite({ userId: 'usr_1', email: 'in@x.com' }, s, d), null);
    }
    assert.equal(d.calls.lookup, 0);
  });

  it('the userCreated hook never fails signup, and returns at once when off', async () => {
    const t = Date.now();
    const off = { readSettings: async () => ({ ...SETTINGS, botToken: null }) };
    await onUserCreated({ userId: 'usr_9', email: 'in@x.com' }, { settings: SETTINGS }, off);
    await onUserCreated({ userId: 'usr_9', email: 'in@x.com' }, null, { readSettings: async () => null });
    assert.ok(Date.now() - t < 100, 'returns at once when not configured');
  });
});

describe('Slack calls made during signup', () => {
  it('fail at once on a 429 instead of waiting out retry-after', async () => {
    const { createServer } = await import('node:http');
    const { WebClient } = await import('@slack/web-api');
    const { SIGNUP_CALL } = await import('../../../plugins/slack/server/slack-client.js');
    const server = createServer((_req, res) => {
      res.writeHead(429, { 'retry-after': '30', 'content-type': 'application/json' });
      res.end('{"ok":false,"error":"ratelimited"}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const client = new WebClient('xoxb-1', { ...SIGNUP_CALL, slackApiUrl: `http://127.0.0.1:${server.address().port}/api/` });
    const started = Date.now();
    try {
      await assert.rejects(client.users.lookupByEmail({ email: 'a@x.com' }));
      assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    } finally {
      server.close();
    }
  });
});
