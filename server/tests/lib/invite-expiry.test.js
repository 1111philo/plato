/**
 * Invites expire but are kept (lib/invite-expiry.js), and m006 moves pending
 * email invites off DynamoDB's ttl. Runs against the SQLite backend.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB_PATH = './data/test-invite-expiry.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = TEST_DB_PATH;
const { default: db } = await import('../../src/lib/db-sqlite.js');
const { inviteExpired, inviteExpiresAt } = await import('../../src/lib/invite-expiry.js');
const { MIGRATIONS } = await import('../../src/lib/migrations.js');
const m006 = MIGRATIONS.find((m) => m.id === 'm006_keep_invites_on_expiry');

after(() => { for (const f of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f); });
const now = () => Math.floor(Date.now() / 1000);

describe('invite expiry', () => {
  it('reads expiresAt, or an older ttl', () => {
    assert.equal(inviteExpiresAt({ expiresAt: 5 }), 5);
    assert.equal(inviteExpiresAt({ ttl: 7 }), 7);
    assert.equal(inviteExpiresAt({ expiresAt: null, ttl: null }), null);
    assert.equal(inviteExpired({ expiresAt: now() - 10 }), true);
    assert.equal(inviteExpired({ ttl: now() - 10 }), true);
    assert.equal(inviteExpired({ expiresAt: now() + 100 }), false);
    assert.equal(inviteExpired({}), false);
  });

  it('a new email invite has expiresAt (kept on expiry); a link invite keeps ttl (deleted)', async () => {
    await db.createInvite({ inviteToken: 'inv_email', email: 'p@x.com', invitedBy: 'usr_a', profile: { firstName: 'P' } });
    await db.createInvite({ inviteToken: 'inv_link', invitedBy: 'usr_a', isLink: true });
    const email = await db.getInvite('inv_email');
    const link = await db.getInvite('inv_link');
    assert.ok(email.expiresAt > now() + 6 * 86400);
    assert.equal(email.ttl, null);
    assert.ok(link.ttl > now());
    assert.equal(link.expiresAt, null);
  });
});

describe('m006: keep pending email invites on expiry', () => {
  it('moves ttl to expiresAt only for pending email invites, and a second run changes nothing', async () => {
    const t = now() + 3 * 86400;
    // Shape of an invite written before this change: ttl, no expiresAt.
    for (const [token, email, isLink] of [['old_pending', 'old@x.com', 0], ['old_used', 'used@x.com', 0], ['old_link', null, 1]]) {
      await db.createInvite({ inviteToken: token, email, invitedBy: 'usr_a', isLink: !!isLink, profile: email ? { firstName: 'Old' } : null });
    }
    const { default: Database } = await import('better-sqlite3');
    const raw = new Database(TEST_DB_PATH);
    raw.prepare("UPDATE invites SET ttl = ?, expiresAt = NULL WHERE inviteToken IN ('old_pending','old_used')").run(t);
    raw.prepare("UPDATE invites SET status = 'used' WHERE inviteToken = 'old_used'").run();
    raw.close();

    const first = await m006.run({ db, dryRun: false });
    assert.equal(first.errors, 0);
    const moved = await db.getInvite('old_pending');
    assert.equal(moved.expiresAt, t);
    assert.equal(moved.ttl, null);
    assert.deepEqual(moved.profile, { firstName: 'Old' });
    assert.equal((await db.getInvite('old_used')).ttl, t, 'used invites are left alone');
    assert.ok((await db.getInvite('old_link')).ttl, 'link invites keep ttl');
    assert.ok(first.updated >= 1);

    const second = await m006.run({ db, dryRun: false });
    assert.equal(second.updated, 0, 'idempotent');
    const dry = await m006.run({ db, dryRun: true });
    assert.equal(dry.updated, 0);
  });
});
