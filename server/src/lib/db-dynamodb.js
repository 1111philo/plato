import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand,
  UpdateCommand, DeleteCommand, ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  USERS_TABLE, INVITES_TABLE, REFRESH_TOKENS_TABLE, SYNC_DATA_TABLE,
  AUDIT_LOG_TABLE, REFRESH_TOKEN_TTL_DAYS, INVITE_TTL_DAYS, RESET_TOKEN_TTL_HOURS,
} from '../config.js';

const clientOpts = {};
if (process.env.DYNAMODB_ENDPOINT) {
  clientOpts.endpoint = process.env.DYNAMODB_ENDPOINT;
  clientOpts.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
}
const client = new DynamoDBClient(clientOpts);
const doc = DynamoDBDocumentClient.from(client);

const db = {
  // ── Users ──

  async createUser({ userId, email, passwordHash, name, username, userGroup, role, slackUserId }) {
    const now = new Date().toISOString();
    const item = {
      userId, email: email.toLowerCase(), username: username || null, passwordHash, name,
      userGroup: userGroup || null,
      role, createdAt: now, updatedAt: now,
    };
    if (slackUserId) item.slackUserId = slackUserId;
    await doc.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(userId)',
    }));
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

  async deleteUser(userId) {
    await doc.send(new DeleteCommand({
      TableName: USERS_TABLE,
      Key: { userId },
    }));
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

  async listUsers() {
    const items = [];
    let lastKey;
    do {
      const result = await doc.send(new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: '#r = :role',
        ExpressionAttributeNames: { '#r': 'role' },
        ExpressionAttributeValues: { ':role': 'user' },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
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

  async createInvite({ inviteToken, email, invitedBy, slackUserId, isLink = false, usageCount = 0, maxUsages = null }) {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + INVITE_TTL_DAYS * 86400;
    const item = {
      inviteToken,
      invitedBy,
      status: 'pending',
      createdAt: now.toISOString(),
      ttl,
      isLink,
      usageCount,
    };
    if (email) item.email = email.toLowerCase();
    if (slackUserId) item.slackUserId = slackUserId;
    if (maxUsages !== null) item.maxUsages = maxUsages;
    await doc.send(new PutCommand({
      TableName: INVITES_TABLE,
      Item: item,
    }));
  },

  async getInviteByEmail(email) {
    const result = await doc.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() },
    }));
    // Return the most recent pending invite if any
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
    const result = await doc.send(new ScanCommand({
      TableName: INVITES_TABLE,
      FilterExpression: 'isLink = :true AND #s = :pending',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':true': true, ':pending': 'pending' },
      Limit: 1,
    }));
    return (result.Items && result.Items[0]) || null;
  },

  async incrementLinkUsage(inviteToken) {
    await doc.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken },
      UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :one',
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
    }));
  },

  // ── Refresh Tokens ──

  async storeRefreshToken(tokenHash, userId) {
    const ttl = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_DAYS * 86400;
    await doc.send(new PutCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Item: { tokenHash, userId, createdAt: new Date().toISOString(), ttl },
    }));
  },

  async getRefreshToken(tokenHash) {
    const result = await doc.send(new GetCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
    }));
    return result.Item || null;
  },

  async deleteRefreshToken(tokenHash) {
    await doc.send(new DeleteCommand({
      TableName: REFRESH_TOKENS_TABLE,
      Key: { tokenHash },
    }));
  },

  // ── Reset Tokens (reuses refresh-tokens table) ──

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
    if (!item || item.type !== 'reset') return null;
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
