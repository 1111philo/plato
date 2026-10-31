/**
 * Slack auto-invite (#379, plugins/slack/server/auto-invite.js), and the host
 * keeping a plugin's writeOnly settings when a save leaves them out.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { autoInvite, onUserCreated, SIGNUP_WAIT_MS } from '../../../plugins/slack/server/auto-invite.js';

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

  it('does nothing while off, without a channel, or without a token', async () => {
    for (const s of [{ ...SETTINGS, autoInviteEnabled: false }, { ...SETTINGS, autoInviteChannelId: '' }, { ...SETTINGS, botToken: null }]) {
      assert.equal(await autoInvite({ userId: 'usr_1', email: 'in@x.com' }, s, d), null);
    }
    assert.equal(d.calls.lookup, 0);
  });

  it('the userCreated hook never fails signup and never waits past its limit', async () => {
    const t = Date.now();
    await onUserCreated({ userId: 'usr_9', email: 'in@x.com' }, { settings: { ...SETTINGS, botToken: null } });
    await onUserCreated({ userId: 'usr_9', email: 'in@x.com' }, null);
    assert.ok(Date.now() - t < 100, 'returns at once when not configured');
    assert.ok(SIGNUP_WAIT_MS <= 3000);
  });
});
