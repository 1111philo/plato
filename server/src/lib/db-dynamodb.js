import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { rangesExcluding } from './key-ranges.js';
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand,
  UpdateCommand, DeleteCommand, ScanCommand, TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  USERS_TABLE, INVITES_TABLE, REFRESH_TOKENS_TABLE, SYNC_DATA_TABLE,
  AUDIT_LOG_TABLE, REFRESH_TOKEN_TTL_DAYS, INVITE_TTL_DAYS, RESET_TOKEN_TTL_HOURS,
} from '../config.js';

/** An item whose `ttl` (epoch seconds) has passed, though DynamoDB hasn't deleted it yet. */
const expired = (item) => typeof item?.ttl === 'number' && item.ttl < Math.floor(Date.now() / 1000);

const clientOpts = {};
if (process.env.DYNAMODB_ENDPOINT) {
  clientOpts.endpoint = process.env.DYNAMODB_ENDPOINT;
  clientOpts.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
}
const client = new DynamoDBClient(clientOpts);
const doc = DynamoDBDocumentClient.from(client);

// The partition that holds single sign-on guard items (see getUserBySsoKey).
const SSO_GUARD = '_sso';
const ssoGuardPut = (ssoKey, ownerId, now) => ({
  TableName: SYNC_DATA_TABLE,
  Item: { userId: SSO_GUARD, dataKey: ssoKey, ownerId, createdAt: now },
  ConditionExpression: 'attribute_not_exists(dataKey)',
});

// Delete an identity's guard item, only while it still names this owner.
async function releaseSsoGuard(ssoKey, ownerId) {
  try {
    await doc.send(new DeleteCommand({
      TableName: SYNC_DATA_TABLE,
      Key: { userId: SSO_GUARD, dataKey: ssoKey },
      ConditionExpression: 'ownerId = :o',
      ExpressionAttributeValues: { ':o': ownerId },
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

// A guard whose owner no longer exists, or no longer holds this identity, is
// stale (an account deleted before deleteUser released guards, or a write
// that died between steps). Remove it so the identity can be used again.
// True if a stale guard was removed.
async function dropStaleSsoGuard(ssoKey) {
  const guard = (await doc.send(new GetCommand({ TableName: SYNC_DATA_TABLE, Key: { userId: SSO_GUARD, dataKey: ssoKey }, ConsistentRead: true }))).Item;
  if (!guard?.ownerId) return false;
  const owner = (await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: guard.ownerId }, ConsistentRead: true }))).Item;
  if (owner?.ssoKey === ssoKey) return false; // a live link
  await releaseSsoGuard(ssoKey, guard.ownerId);
  return true;
}

const db = {
  // ── Users ──

  async createUser({ userId, email, passwordHash, name, firstName, lastName, nameSource, username, userGroup, role, slackUserId, customFields, sso, emailVerifiedAt }) {
    const now = new Date().toISOString();
    const item = {
      userId, email: email.toLowerCase(), username: username || null, name,
      userGroup: userGroup || null,
      role, createdAt: now, updatedAt: now,
    };
    // An account made by single sign-on has no password (lib/external-identity.js).
    if (passwordHash) item.passwordHash = passwordHash;
    if (emailVerifiedAt) item.emailVerifiedAt = emailVerifiedAt;
    if (firstName !== undefined) Object.assign(item, { firstName, lastName: lastName || '', nameSource: nameSource || 'user' });
    if (slackUserId) item.slackUserId = slackUserId;
    if (customFields && Object.keys(customFields).length > 0) item.customFields = customFields;
    const put = { TableName: USERS_TABLE, Item: item, ConditionExpression: 'attribute_not_exists(userId)' };
    if (!sso?.key) {
      await doc.send(new PutCommand(put));
      return;
    }
    // With an identity: the account and the identity's guard item are written
    // together, so one identity can never end up on two accounts.
    Object.assign(item, { ssoKey: sso.key, ssoEmail: sso.email || null, ssoLinkedAt: now });
    const write = () => doc.send(new TransactWriteCommand({ TransactItems: [{ Put: put }, { Put: ssoGuardPut(sso.key, userId, now) }] }));
    try {
      await write();
    } catch (err) {
      if (err.name !== 'TransactionCanceledException') throw err;
      const exists = Object.assign(new Error('User or identity already exists'), { name: 'ConditionalCheckFailedException' });
      if (!(await dropStaleSsoGuard(sso.key))) throw exists;
      try { await write(); } catch (again) { if (again.name === 'TransactionCanceledException') throw exists; throw again; }
    }
  },

  async getUserById(userId) {
    const result = await doc.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId },
    }));
    return result.Item || null;
  },

  async getUserByEmail(email) {
    const result = await doc.send(new QueryCommand({
      TableName: USERS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() },
    }));
    return result.Items?.[0] || null;
  },

  // Single sign-on (lib/external-identity.js). `ssoKey` on the user is
  // '<provider>:<tenant>:<subject>'. The identity's owner is recorded in a
  // guard item (sync-data partition `_sso`, key = the ssoKey), written in the
  // same transaction as the user, so "one identity, one account" is enforced
  // by the database and read with strong consistency (an index couldn't do
  // either).
  async getUserBySsoKey(ssoKey) {
    const guard = await doc.send(new GetCommand({ TableName: SYNC_DATA_TABLE, Key: { userId: SSO_GUARD, dataKey: ssoKey }, ConsistentRead: true }));
    if (!guard.Item?.ownerId) return null;
    const result = await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: guard.Item.ownerId }, ConsistentRead: true }));
    return result.Item?.ssoKey === ssoKey ? result.Item : null;
  },

  // Connect an identity to an account that has none. False if the account
  // already has one, or the identity belongs to another account.
  async linkUserSso(userId, { key, email }) {
    const now = new Date().toISOString();
    const write = () => doc.send(new TransactWriteCommand({
      TransactItems: [
        { Put: ssoGuardPut(key, userId, now) },
        {
          Update: {
            TableName: USERS_TABLE,
            Key: { userId },
            UpdateExpression: 'SET ssoKey = :k, ssoEmail = :e, ssoLinkedAt = :now, updatedAt = :now',
            ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(ssoKey)',
            ExpressionAttributeValues: { ':k': key, ':e': email || null, ':now': now },
          },
        },
      ],
    }));
    try {
      await write();
      return true;
    } catch (err) {
      if (err.name !== 'TransactionCanceledException') throw err;
      if (!(await dropStaleSsoGuard(key))) return false;
      try { await write(); return true; } catch (again) { if (again.name === 'TransactionCanceledException') return false; throw again; }
    }
  },

  // Removes the identity this read saw, and only that one: the update is
  // conditional on it, so a link that lands in between isn't the one removed
  // (and its guard item isn't orphaned). One retry on a lost race.
  async clearUserSso(userId, attempt = 0) {
    const user = (await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId }, ConsistentRead: true }))).Item;
    if (!user?.ssoKey) return;
    try {
      await doc.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: USERS_TABLE,
              Key: { userId },
              UpdateExpression: 'REMOVE ssoKey, ssoEmail, ssoLinkedAt SET updatedAt = :now',
              ConditionExpression: 'ssoKey = :k',
              ExpressionAttributeValues: { ':now': new Date().toISOString(), ':k': user.ssoKey },
            },
          },
          { Delete: { TableName: SYNC_DATA_TABLE, Key: { userId: SSO_GUARD, dataKey: user.ssoKey } } },
        ],
      }));
    } catch (err) {
      if (err.name === 'TransactionCanceledException' && attempt < 1) return db.clearUserSso(userId, attempt + 1);
      throw err;
    }
  },

  async getUserByUsername(username) {
    const result = await doc.send(new QueryCommand({
      TableName: USERS_TABLE,
      IndexName: 'username-index',
      KeyConditionExpression: 'username = :username',
      ExpressionAttributeValues: { ':username': username.toLowerCase() },
    }));
    return result.Items?.[0] || null;
  },

  async updateUser(userId, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const expr = keys.map((k, i) => `#k${i} = :v${i}`).join(', ');
    const names = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
    const values = Object.fromEntries(keys.map((k, i) => [`:v${i}`, fields[k]]));
    names['#upd'] = 'updatedAt';
    values[':now'] = new Date().toISOString();
    await doc.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: `SET ${expr}, #upd = :now`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  },

  // Deleting an account releases its single sign-on identity: the guard item
  // goes with it, or the identity could never be connected to another account.
  async deleteUser(userId) {
    const result = await doc.send(new DeleteCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      ReturnValues: 'ALL_OLD',
    }));
    const ssoKey = result.Attributes?.ssoKey;
    if (ssoKey) await releaseSsoGuard(ssoKey, userId);
  },

  // Lightweight writes used by the sync-route hooks. They deliberately do
  // NOT touch updatedAt — these are activity-tracking side effects, not
  // user-profile edits.
  async incrementUserCounter(userId, field, delta = 1) {
    if (!['lessonsCompleted'].includes(field)) throw new Error(`Unsupported counter field: ${field}`);
    await doc.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'ADD #f :d',
      ExpressionAttributeNames: { '#f': field },
      ExpressionAttributeValues: { ':d': delta },
    }));
  },

  async setUserActivityField(userId, field, value) {
    if (!['lastActiveAt', 'lessonsCompleted'].includes(field)) throw new Error(`Unsupported activity field: ${field}`);
    await doc.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'SET #f = :v',
      ExpressionAttributeNames: { '#f': field },
      ExpressionAttributeValues: { ':v': value },
    }));
  },

  // Remove one custom user field value (#364) in place — a nested REMOVE, not
  // a read-modify-write of the whole map, so a concurrent profile save to a
  // different field can't be clobbered by an admin deleting this one.
  async removeUserCustomField(userId, fieldId) {
    await doc.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      UpdateExpression: 'REMOVE #cf.#id',
      ConditionExpression: 'attribute_exists(#cf)',
      ExpressionAttributeNames: { '#cf': 'customFields', '#id': fieldId },
    })).catch((err) => {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    });
  },

  // Migration helper: change a user's role only if it still holds `from`.
  // Deliberately leaves updatedAt alone (a data migration, not a profile
  // edit). Returns true if it changed the record.
  async setUserRoleIf(userId, from, to) {
    try {
      await doc.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: 'SET #r = :to',
        ConditionExpression: '#r = :from',
        ExpressionAttributeNames: { '#r': 'role' },
        ExpressionAttributeValues: { ':from': from, ':to': to },
      }));
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  },

  // Migration helper: set the inferred name split (#402) only while `name` is
  // still `expectedName` and no split exists yet. Leaves updatedAt alone.
  async setUserNameSplitIf(userId, expectedName, { firstName, lastName, nameSource }) {
    try {
      await doc.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: 'SET #f = :f, #l = :l, #s = :s',
        ConditionExpression: '#n = :n AND attribute_not_exists(#f)',
        ExpressionAttributeNames: { '#f': 'firstName', '#l': 'lastName', '#s': 'nameSource', '#n': 'name' },
        ExpressionAttributeValues: { ':f': firstName, ':l': lastName, ':s': nameSource, ':n': expectedName },
      }));
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  },

  async listAllUsers() {
    const items = [];
    let lastKey;
    do {
      const result = await doc.send(new ScanCommand({
        TableName: USERS_TABLE,
        ExclusiveStartKey: lastKey,
      }));
      items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },

  // Is there at least one user? One item, not a full Scan (cold start, #451 B3).
  async hasAnyUser() {
    const result = await doc.send(new ScanCommand({ TableName: USERS_TABLE, Limit: 1, ProjectionExpression: 'userId' }));
    return (result.Items || []).length > 0 || !!result.LastEvaluatedKey;
  },

  async countUsers() {
    let count = 0;
    let lastKey;
    do {
      const result = await doc.send(new ScanCommand({
        TableName: USERS_TABLE,
        Select: 'COUNT',
        ExclusiveStartKey: lastKey,
      }));
      count += result.Count;
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return count;
  },

  // ── Invites ──

  async createInvite({ inviteToken, email, invitedBy, slackUserId, isLink = false, usageCount = 0, maxUsages = null, profile = null, forUserId = null }) {
    const now = new Date();
    const expires = Math.floor(now.getTime() / 1000) + INVITE_TTL_DAYS * 86400;
    const item = {
      inviteToken,
      invitedBy,
      status: 'pending',
      createdAt: now.toISOString(),
      // Email invites are kept when they expire (lib/invite-expiry.js); only
      // link invites use DynamoDB's ttl and get deleted.
      ...(isLink ? { ttl: expires } : { expiresAt: expires }),
      isLink,
      usageCount,
    };
    if (email) item.email = email.toLowerCase();
    if (slackUserId) item.slackUserId = slackUserId;
    if (maxUsages !== null) item.maxUsages = maxUsages;
    if (profile) item.profile = profile;
    if (forUserId) item.forUserId = forUserId;
    await doc.send(new PutCommand({
      TableName: INVITES_TABLE,
      Item: item,
    }));
  },

  // Wait-list entries (#363) share the invites table with status 'waitlist' and
  // no ttl, so they never expire and the pending-only lookups skip them.
  async createWaitlistEntry({ inviteToken, email, profile }) {
    await doc.send(new PutCommand({
      TableName: INVITES_TABLE,
      Item: {
        inviteToken,
        email: email.toLowerCase(),
        status: 'waitlist',
        createdAt: new Date().toISOString(),
        profile,
      },
      // Create-only: the route derives the token from the email, so a second
      // concurrent join for the same address fails here instead of duplicating.
      ConditionExpression: 'attribute_not_exists(inviteToken)',
    }));
  },

  // Replace an invite / wait-list entry's stored profile (used when a custom
  // user field is deleted, so its answers are erased here too).
  async setInviteProfile(inviteToken, profile) {
    await doc.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
      UpdateExpression: 'SET #p = :p',
      ConditionExpression: 'attribute_exists(inviteToken)',
      ExpressionAttributeNames: { '#p': 'profile' },
      ExpressionAttributeValues: { ':p': profile },
    })).catch((err) => {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    });
  },

  // Edit a wait-list entry in place (#363). Conditional on it still being a
  // wait-list entry, so an edit racing an Invite can't resurrect it.
  async updateWaitlistEntry(inviteToken, { email, profile }) {
    await doc.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
      UpdateExpression: 'SET #e = :e, #p = :p',
      ConditionExpression: '#s = :waitlist',
      ExpressionAttributeNames: { '#e': 'email', '#p': 'profile', '#s': 'status' },
      ExpressionAttributeValues: { ':e': email.toLowerCase(), ':p': profile, ':waitlist': 'waitlist' },
    }));
  },

  async getWaitlistEntryByEmail(email) {
    const result = await doc.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() },
    }));
    return (result.Items || []).find(i => i.status === 'waitlist') || null;
  },

  async getInviteByEmail(email) {
    const result = await doc.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() },
    }));
    const pending = (result.Items || []).filter(i => i.status === 'pending');
    return pending[0] || null;
  },

  async getInvite(inviteToken) {
    const result = await doc.send(new GetCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
    }));
    return result.Item || null;
  },

  // m006: keep a pending email invite when it expires. Moves `ttl` (which
  // DynamoDB deletes on) to `expiresAt`, only if it's still pending with that ttl.
  async keepInviteOnExpiry(inviteToken, ttl) {
    try {
      await doc.send(new UpdateCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken },
        UpdateExpression: 'SET expiresAt = :t REMOVE #ttl',
        ConditionExpression: '#s = :pending AND #ttl = :t',
        ExpressionAttributeNames: { '#s': 'status', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':pending': 'pending', ':t': ttl },
      }));
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  },

  async markInviteUsed(inviteToken) {
    await doc.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
      UpdateExpression: 'SET #s = :used, usedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':used': 'used', ':now': new Date().toISOString() },
    }));
  },

  async deleteInvite(inviteToken) {
    await doc.send(new DeleteCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
    }));
  },

  async listInvites() {
    const items = [];
    let lastKey;
    do {
      const result = await doc.send(new ScanCommand({
        TableName: INVITES_TABLE,
        ExclusiveStartKey: lastKey,
      }));
      items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },

  async getInviteLinkToken() {
    // No `Limit` here: DynamoDB applies Limit BEFORE FilterExpression, so
    // `Limit: 1` only ever examined one row and missed the link invite
    // whenever it wasn't first in the scan. Page until a match is found.
    let lastKey;
    do {
      const result = await doc.send(new ScanCommand({
        TableName: INVITES_TABLE,
        FilterExpression: 'isLink = :true AND #s = :pending',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':true': true, ':pending': 'pending' },
        ExclusiveStartKey: lastKey,
      }));
      if (result.Items?.length) return result.Items[0];
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return null;
  },

  async incrementLinkUsage(inviteToken) {
    // Atomic increment with usage limit check to prevent race condition.
    // If maxUsages is set and would be exceeded, the conditional update fails.
    await doc.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
      UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
      ConditionExpression: 'attribute_not_exists(maxUsages) OR maxUsages > usageCount',
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
    }));
  },

  // ── Refresh Tokens ──

  // `tokenVersion`: the user's session version when the token was issued
  // (routes/auth.js, lib/sessions.js). Reset tokens share this table, so
  // getRefreshToken refuses them; both readers refuse an expired item,
  // because DynamoDB's TTL deletion can lag by up to ~48 h.
  async storeRefreshToken(tokenHash, userId, { tokenVersion = 0 } = {}) {
    const ttl = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_DAYS * 86400;
    await doc.send(new PutCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Item: { tokenHash, userId, tokenVersion, createdAt: new Date().toISOString(), ttl },
    }));
  },

  async getRefreshToken(tokenHash) {
    const result = await doc.send(new GetCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
    }));
    const item = result.Item;
    if (!item || item.type === 'reset' || item.type === 'sso' || expired(item)) return null;
    return item;
  },

  // A refresh token that was just exchanged stays usable for a short grace
  // (parallel tabs and requests refreshing at once), then expires.
  async markRefreshTokenRotated(tokenHash, graceSeconds) {
    await doc.send(new UpdateCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
      UpdateExpression: 'SET rotatedAt = if_not_exists(rotatedAt, :now), #ttl = :ttl',
      ConditionExpression: 'attribute_exists(tokenHash)',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':now': new Date().toISOString(), ':ttl': Math.floor(Date.now() / 1000) + graceSeconds },
    }));
  },

  async deleteRefreshToken(tokenHash) {
    await doc.send(new DeleteCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
    }));
  },

  // ── Reset Tokens (reuses refresh-tokens table) ──

  // One-time codes (the sign-in handoff after single sign-on, routes/sso.js):
  // kept in the tokens table under their own type, deleted on first read.
  async storeOneTimeCode(codeHash, data, ttlSeconds) {
    const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;
    await doc.send(new PutCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Item: { tokenHash: codeHash, type: 'sso', data, createdAt: new Date().toISOString(), ttl },
    }));
  },

  async takeOneTimeCode(codeHash) {
    const result = await doc.send(new DeleteCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash: codeHash },
      ReturnValues: 'ALL_OLD',
    }));
    const item = result.Attributes;
    if (!item || item.type !== 'sso' || expired(item)) return null;
    return item.data;
  },

  async storeResetToken(tokenHash, userId) {
    const ttl = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_HOURS * 3600;
    await doc.send(new PutCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Item: { tokenHash, userId, type: 'reset', createdAt: new Date().toISOString(), ttl },
    }));
  },

  async getResetToken(tokenHash) {
    const result = await doc.send(new GetCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
    }));
    const item = result.Item;
    if (!item || item.type !== 'reset' || expired(item)) return null;
    return item;
  },

  async deleteResetToken(tokenHash) {
    await doc.send(new DeleteCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
    }));
  },

  // ── Sync Data ──

  async getSyncData(userId, dataKey) {
    const result = await doc.send(new GetCommand({
      TableName: SYNC_DATA_TABLE,
      Key: { userId, dataKey },
    }));
    return result.Item || null;
  },

  async getAllSyncData(userId) {
    const items = [];
    let lastKey;
    do {
      const result = await doc.send(new QueryCommand({
        TableName: SYNC_DATA_TABLE,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },

  // Fetch only the sync-data records whose dataKey begins with `prefix`
  // (a sort-key condition, so DynamoDB reads only the matching items — RCU
  // and payload scale with the matched set, NOT the whole partition). Used by
  // admin stats to read `lessonKB:*` without dragging the large `screenshot:*`
  // / `messages:*` records.
  // Does any record's dataKey begin with `prefix`? One item at most.
  async hasSyncDataWithPrefix(userId, prefix) {
    const result = await doc.send(new QueryCommand({
      TableName: SYNC_DATA_TABLE,
      KeyConditionExpression: 'userId = :uid AND begins_with(dataKey, :p)',
      ExpressionAttributeValues: { ':uid': userId, ':p': prefix },
      ProjectionExpression: 'dataKey',
      Limit: 1,
    }));
    return (result.Items || []).length > 0;
  },

  async getSyncDataByPrefix(userId, prefix) {
    const items = [];
    let lastKey;
    do {
      const result = await doc.send(new QueryCommand({
        TableName: SYNC_DATA_TABLE,
        KeyConditionExpression: 'userId = :uid AND begins_with(dataKey, :p)',
        ExpressionAttributeValues: { ':uid': userId, ':p': prefix },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },

  // Every record except those whose key starts with one of `prefixes` (one
  // prefix or a list), as key-range queries around them, so the excluded
  // records are never read or billed. GET /v1/sync uses it to skip
  // screenshots (#451 scale review) and Trace records.
  async getSyncDataExcept(userId, prefixes) {
    const { ranges, excluded } = rangesExcluding(prefixes);
    const items = [];
    for (const { from, to } of ranges) {
      const cond = from === undefined ? 'dataKey < :b' : to === undefined ? 'dataKey >= :a' : 'dataKey BETWEEN :a AND :b';
      let lastKey;
      do {
        const result = await doc.send(new QueryCommand({
          TableName: SYNC_DATA_TABLE,
          KeyConditionExpression: `userId = :uid AND ${cond}`,
          ExpressionAttributeValues: { ':uid': userId, ...(from !== undefined ? { ':a': from } : {}), ...(to !== undefined ? { ':b': to } : {}) },
          ExclusiveStartKey: lastKey,
        }));
        items.push(...result.Items);
        lastKey = result.LastEvaluatedKey;
      } while (lastKey);
    }
    return items.filter((item) => !excluded(item.dataKey));
  },

  async putSyncData(userId, dataKey, data, expectedVersion) {
    const now = new Date().toISOString();
    const newVersion = (expectedVersion || 0) + 1;
    const params = {
      TableName: SYNC_DATA_TABLE,
      Item: { userId, dataKey, data, updatedAt: now, version: newVersion },
    };
    if (expectedVersion) {
      params.ConditionExpression = 'attribute_not_exists(version) OR version = :v';
      params.ExpressionAttributeValues = { ':v': expectedVersion };
    }
    await doc.send(new PutCommand(params));
    return { version: newVersion, updatedAt: now };
  },

  // Create-only write: throws ConditionalCheckFailedException if the record
  // already exists. putSyncData with expectedVersion 0/undefined is an
  // unconditional overwrite, so it can't be used for "create if absent"
  // (migration state, bundled content) where concurrent cold starts race.
  async createSyncData(userId, dataKey, data) {
    const now = new Date().toISOString();
    await doc.send(new PutCommand({
      TableName: SYNC_DATA_TABLE,
      Item: { userId, dataKey, data, updatedAt: now, version: 1 },
      ConditionExpression: 'attribute_not_exists(dataKey)',
    }));
    return { version: 1, updatedAt: now };
  },

  async deleteSyncData(userId, dataKey) {
    await doc.send(new DeleteCommand({
      TableName: SYNC_DATA_TABLE,
      Key: { userId, dataKey },
    }));
  },

  // ── Audit Log ──

  async createAuditLog({ action, userId, email, performedBy, details }) {
    const now = new Date().toISOString();
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await doc.send(new PutCommand({
      TableName: AUDIT_LOG_TABLE,
      Item: { logId, action, userId, email, performedBy, details: details || null, createdAt: now },
    }));
  },

  // Full-table Scan with filter — the audit-log table has no GSI on userId.
  // Fine at current scale; add a userId-createdAt GSI when the table grows
  // past ~100k entries.
  async listAuditLogsForUser(userId, sinceIso) {
    const items = [];
    let lastKey;
    do {
      const result = await doc.send(new ScanCommand({
        TableName: AUDIT_LOG_TABLE,
        FilterExpression: sinceIso ? '#u = :u AND createdAt >= :since' : '#u = :u',
        ExpressionAttributeNames: { '#u': 'userId' },
        ExpressionAttributeValues: sinceIso ? { ':u': userId, ':since': sinceIso } : { ':u': userId },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },
};

export default db;
