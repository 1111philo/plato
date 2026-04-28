import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';

// Configure for SQLite before importing
const TEST_DB_PATH = './data/test-db-sqlite.db';
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = TEST_DB_PATH;

const { default: db } = await import('../../src/lib/db-sqlite.js');

// Clean up test DB after all tests
after(() => {
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  // WAL files
  if (existsSync(TEST_DB_PATH + '-wal')) unlinkSync(TEST_DB_PATH + '-wal');
  if (existsSync(TEST_DB_PATH + '-shm')) unlinkSync(TEST_DB_PATH + '-shm');
});

describe('db-sqlite', () => {
  describe('users', () => {
    const userId = `usr_test_${Date.now()}`;

    it('creates and retrieves a user', async () => {
      await db.createUser({
        userId,
        email: 'Test@Example.com',
        username: 'testuser',
        passwordHash: '$2a$12$fake',
        name: 'Test User',
        role: 'user',
      });

      const user = await db.getUserById(userId);
      assert.equal(user.userId, userId);
      assert.equal(user.email, 'test@example.com'); // lowercase
      assert.equal(user.username, 'testuser');
      assert.equal(user.name, 'Test User');
      assert.equal(user.role, 'user');
    });

    it('retrieves user by email (case-insensitive)', async () => {
      const user = await db.getUserByEmail('TEST@example.COM');
      assert.equal(user.userId, userId);
    });

    it('retrieves user by username (case-insensitive)', async () => {
      const user = await db.getUserByUsername('TESTUSER');
      assert.equal(user.userId, userId);
    });

    it('rejects duplicate userId', async () => {
      await assert.rejects(() => db.createUser({
        userId,
        email: 'other@example.com',
        passwordHash: '$2a$12$fake',
        name: 'Dup',
        role: 'user',
      }), { name: 'ConditionalCheckFailedException' });
    });

    it('updates user fields', async () => {
      await db.updateUser(userId, { name: 'Updated Name', userGroup: 'Test Org' });
      const user = await db.getUserById(userId);
      assert.equal(user.name, 'Updated Name');
      assert.equal(user.userGroup, 'Test Org');
    });

    it('counts users', async () => {
      const count = await db.countUsers();
      assert.ok(count >= 1);
    });

    it('lists users', async () => {
      const list = await db.listUsers();
      assert.ok(list.some(u => u.userId === userId));
    });

    it('deletes a user', async () => {
      await db.deleteUser(userId);
      const user = await db.getUserById(userId);
      assert.equal(user, null);
    });
  });

  describe('invites', () => {
    const token = `inv_test_${Date.now()}`;

    it('creates and retrieves an invite', async () => {
      await db.createInvite({
        inviteToken: token,
        email: 'invite@test.com',
        invitedBy: 'usr_admin',
      });

      const invite = await db.getInvite(token);
      assert.equal(invite.inviteToken, token);
      assert.equal(invite.status, 'pending');
    });

    it('finds invite by email', async () => {
      const invite = await db.getInviteByEmail('invite@test.com');
      assert.equal(invite.inviteToken, token);
    });

    it('marks invite as used', async () => {
      await db.markInviteUsed(token);
      const invite = await db.getInvite(token);
      assert.equal(invite.status, 'used');
    });

    it('lists all invites', async () => {
      const list = await db.listInvites();
      assert.ok(list.some(i => i.inviteToken === token));
    });

    it('deletes an invite', async () => {
      await db.deleteInvite(token);
      assert.equal(await db.getInvite(token), null);
    });
  });

  describe('refresh tokens', () => {
    const hash = 'testhash_' + Date.now();

    it('stores and retrieves a refresh token', async () => {
      await db.storeRefreshToken(hash, 'usr_test');
      const token = await db.getRefreshToken(hash);
      assert.equal(token.userId, 'usr_test');
      assert.equal(token.type, 'refresh');
    });

    it('deletes a refresh token', async () => {
      await db.deleteRefreshToken(hash);
      assert.equal(await db.getRefreshToken(hash), null);
    });
  });

  describe('reset tokens', () => {
    const hash = 'resethash_' + Date.now();

    it('stores and retrieves a reset token', async () => {
      await db.storeResetToken(hash, 'usr_test');
      const token = await db.getResetToken(hash);
      assert.equal(token.userId, 'usr_test');
      assert.equal(token.type, 'reset');
    });

    it('returns null for non-reset tokens via getResetToken', async () => {
      const refreshHash = 'refresh_' + Date.now();
      await db.storeRefreshToken(refreshHash, 'usr_test');
      assert.equal(await db.getResetToken(refreshHash), null);
      await db.deleteRefreshToken(refreshHash);
    });

    it('deletes a reset token', async () => {
      await db.deleteResetToken(hash);
      assert.equal(await db.getResetToken(hash), null);
    });
  });

  describe('sync data', () => {
    const userId = 'usr_sync_test';

    it('puts and gets sync data', async () => {
      const result = await db.putSyncData(userId, 'profile', { name: 'Blake' }, 0);
      assert.equal(result.version, 1);

      const item = await db.getSyncData(userId, 'profile');
      assert.deepEqual(item.data, { name: 'Blake' });
      assert.equal(item.version, 1);
    });

    it('increments version on update', async () => {
      const result = await db.putSyncData(userId, 'profile', { name: 'Blake Updated' }, 1);
      assert.equal(result.version, 2);
    });

    it('rejects version conflict', async () => {
      await assert.rejects(
        () => db.putSyncData(userId, 'profile', { name: 'Conflict' }, 999),
        { name: 'ConditionalCheckFailedException' }
      );
    });

    it('gets all sync data for a user', async () => {
      await db.putSyncData(userId, 'preferences', { name: 'Test' }, 0);
      const all = await db.getAllSyncData(userId);
      assert.ok(all.length >= 2);
      assert.ok(all.some(i => i.dataKey === 'profile'));
      assert.ok(all.some(i => i.dataKey === 'preferences'));
    });

    it('deletes sync data', async () => {
      await db.deleteSyncData(userId, 'preferences');
      assert.equal(await db.getSyncData(userId, 'preferences'), null);
    });
  });

  describe('audit log', () => {
    it('creates an audit log entry', async () => {
      await db.createAuditLog({
        action: 'user_deleted',
        userId: 'usr_deleted',
        email: 'deleted@test.com',
        performedBy: 'usr_admin',
        details: { reason: 'test' },
      });
      // No retrieval API exists — just verify it doesn't throw
    });
  });
});
