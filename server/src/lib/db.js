/**
 * Database abstraction layer — DynamoDB via AWS SDK v3.
 *
 * Tables (all prefixed with DYNAMODB_TABLE_PREFIX env var, default 'plato-'):
 *   users           — user records
 *   invites         — invite tokens
 *   refresh-tokens  — JWT refresh tokens
 *   sync-data       — all user + system content (lessons, KBs, profiles, settings)
 *   audit-log       — append-only event log
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const IS_LOCAL = process.env.IS_LOCAL === 'true';
const REGION = process.env.AWS_REGION || 'us-east-2';
const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX || 'plato-';

const clientConfig = IS_LOCAL
  ? { region: REGION, endpoint: 'http://localhost:8000', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
  : { region: REGION };

const raw = new DynamoDBClient(clientConfig);
const client = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

function table(name) {
  return `${TABLE_PREFIX}${name}`;
}

// ---------------------------------------------------------------------------
// Bootstrap (local dev only)
// ---------------------------------------------------------------------------

export async function bootstrapLocalTables() {
  if (!IS_LOCAL) return;
  const existing = await raw.send(new ListTablesCommand({}));
  const names = existing.TableNames || [];
  const required = ['users', 'invites', 'refresh-tokens', 'sync-data', 'audit-log'];
  for (const t of required) {
    const full = table(t);
    if (names.includes(full)) continue;
    let keySchema, attrDefs;
    if (t === 'sync-data') {
      keySchema = [{ AttributeName: 'userId', KeyType: 'HASH' }, { AttributeName: 'dataKey', KeyType: 'RANGE' }];
      attrDefs = [{ AttributeName: 'userId', AttributeType: 'S' }, { AttributeName: 'dataKey', AttributeType: 'S' }];
    } else if (t === 'audit-log') {
      keySchema = [{ AttributeName: 'logId', KeyType: 'HASH' }, { AttributeName: 'timestamp', KeyType: 'RANGE' }];
      attrDefs = [{ AttributeName: 'logId', AttributeType: 'S' }, { AttributeName: 'timestamp', AttributeType: 'N' }];
    } else if (t === 'refresh-tokens') {
      keySchema = [{ AttributeName: 'tokenHash', KeyType: 'HASH' }];
      attrDefs = [{ AttributeName: 'tokenHash', AttributeType: 'S' }];
    } else {
      keySchema = [{ AttributeName: t === 'invites' ? 'inviteToken' : 'userId', KeyType: 'HASH' }];
      attrDefs = [{ AttributeName: t === 'invites' ? 'inviteToken' : 'userId', AttributeType: 'S' }];
    }
    await raw.send(new CreateTableCommand({
      TableName: full,
      KeySchema: keySchema,
      AttributeDefinitions: attrDefs,
      BillingMode: 'PAY_PER_REQUEST',
    }));
    console.log(`Created local table: ${full}`);
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUserById(userId) {
  const res = await client.send(new GetCommand({ TableName: table('users'), Key: { userId } }));
  return res.Item || null;
}

export async function getUserByEmail(email) {
  const res = await client.send(new ScanCommand({
    TableName: table('users'),
    FilterExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email.toLowerCase() },
  }));
  return res.Items?.[0] || null;
}

export async function getUserByUsername(username) {
  const res = await client.send(new ScanCommand({
    TableName: table('users'),
    FilterExpression: 'username = :u',
    ExpressionAttributeValues: { ':u': username.toLowerCase() },
  }));
  return res.Items?.[0] || null;
}

export async function listAllUsers() {
  const res = await client.send(new ScanCommand({ TableName: table('users') }));
  return res.Items || [];
}

export async function createUser(user) {
  await client.send(new PutCommand({ TableName: table('users'), Item: user }));
}

export async function updateUser(userId, updates) {
  const entries = Object.entries(updates);
  if (!entries.length) return;
  const expr = 'SET ' + entries.map((_, i) => `#k${i} = :v${i}`).join(', ');
  const names = Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k]));
  const vals = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]));
  await client.send(new UpdateCommand({
    TableName: table('users'),
    Key: { userId },
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: vals,
  }));
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function getInvite(token) {
  const res = await client.send(new GetCommand({ TableName: table('invites'), Key: { inviteToken: token } }));
  return res.Item || null;
}

export async function getInviteByEmail(email) {
  const res = await client.send(new ScanCommand({
    TableName: table('invites'),
    FilterExpression: 'email = :e AND #s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':e': email.toLowerCase(), ':s': 'pending' },
  }));
  return res.Items?.[0] || null;
}

export async function listInvites() {
  const res = await client.send(new ScanCommand({ TableName: table('invites') }));
  return res.Items || [];
}

export async function createInvite(invite) {
  const item = { ...invite, status: 'pending', createdAt: Date.now() };
  await client.send(new PutCommand({ TableName: table('invites'), Item: item }));
}

export async function updateInviteStatus(token, status) {
  await client.send(new UpdateCommand({
    TableName: table('invites'),
    Key: { inviteToken: token },
    UpdateExpression: 'SET #s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status },
  }));
}

export async function deleteInvite(token) {
  await client.send(new DeleteCommand({ TableName: table('invites'), Key: { inviteToken: token } }));
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

export async function getRefreshToken(tokenHash) {
  const res = await client.send(new GetCommand({ TableName: table('refresh-tokens'), Key: { tokenHash } }));
  return res.Item || null;
}

export async function createRefreshToken(item) {
  await client.send(new PutCommand({ TableName: table('refresh-tokens'), Item: item }));
}

export async function deleteRefreshToken(tokenHash) {
  await client.send(new DeleteCommand({ TableName: table('refresh-tokens'), Key: { tokenHash } }));
}

export async function deleteRefreshTokensByUserId(userId) {
  const res = await client.send(new ScanCommand({
    TableName: table('refresh-tokens'),
    FilterExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
  }));
  await Promise.all((res.Items || []).map(item =>
    client.send(new DeleteCommand({ TableName: table('refresh-tokens'), Key: { tokenHash: item.tokenHash } }))
  ));
}

// ---------------------------------------------------------------------------
// Sync data (lessons, KBs, profiles, settings — keyed by userId + dataKey)
// ---------------------------------------------------------------------------

export async function getSyncData(userId, dataKey) {
  const res = await client.send(new GetCommand({
    TableName: table('sync-data'),
    Key: { userId, dataKey },
  }));
  return res.Item || null;
}

export async function putSyncData(userId, dataKey, content) {
  await client.send(new PutCommand({
    TableName: table('sync-data'),
    Item: { userId, dataKey, content, updatedAt: Date.now() },
  }));
}

export async function listSyncDataByPrefix(userId, prefix) {
  const res = await client.send(new QueryCommand({
    TableName: table('sync-data'),
    KeyConditionExpression: 'userId = :u AND begins_with(dataKey, :p)',
    ExpressionAttributeValues: { ':u': userId, ':p': prefix },
  }));
  return res.Items || [];
}

export async function deleteSyncData(userId, dataKey) {
  await client.send(new DeleteCommand({
    TableName: table('sync-data'),
    Key: { userId, dataKey },
  }));
}

// ---------------------------------------------------------------------------
// Lessons (stored as _system sync-data with key lesson:*)
// ---------------------------------------------------------------------------

export async function listLessons() {
  const res = await client.send(new QueryCommand({
    TableName: table('sync-data'),
    KeyConditionExpression: 'userId = :u AND begins_with(dataKey, :p)',
    ExpressionAttributeValues: { ':u': '_system', ':p': 'lesson:' },
  }));
  return (res.Items || []).map(item => item.content);
}

export async function getLesson(lessonId) {
  const res = await client.send(new GetCommand({
    TableName: table('sync-data'),
    Key: { userId: '_system', dataKey: `lesson:${lessonId}` },
  }));
  return res.Item?.content || null;
}

export async function putLesson(lessonId, lesson) {
  await client.send(new PutCommand({
    TableName: table('sync-data'),
    Item: { userId: '_system', dataKey: `lesson:${lessonId}`, content: lesson, updatedAt: Date.now() },
  }));
}

export async function deleteLesson(lessonId) {
  await client.send(new DeleteCommand({
    TableName: table('sync-data'),
    Key: { userId: '_system', dataKey: `lesson:${lessonId}` },
  }));
}

// ---------------------------------------------------------------------------
// Lesson KBs — per-user lesson knowledge bases (keyed lessonKB:<lessonId>)
// Used for completion stats: scan all users for a given lessonId.
// ---------------------------------------------------------------------------

/**
 * Fetch all completed lesson KB records for a given lessonId across all users.
 * Used to compute per-lesson time stats for the estimated duration tag.
 * Returns an array of KB content objects with activitiesCompleted field.
 */
export async function getCompletedLessonKBs(lessonId) {
  const dataKey = `lessonKB:${lessonId}`;
  const res = await client.send(new ScanCommand({
    TableName: table('sync-data'),
    FilterExpression: 'dataKey = :dk AND content.#s = :completed',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':dk': dataKey, ':completed': 'completed' },
  }));
  return (res.Items || []).map(item => item.content).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function putAuditEvent(event) {
  await client.send(new PutCommand({
    TableName: table('audit-log'),
    Item: { ...event, timestamp: Date.now() },
  }));
}

export async function listAuditEvents(limit = 100) {
  const res = await client.send(new ScanCommand({
    TableName: table('audit-log'),
    Limit: limit,
  }));
  return res.Items || [];
}

const db = {
  getUserById,
  getUserByEmail,
  getUserByUsername,
  listAllUsers,
  createUser,
  updateUser,
  getInvite,
  getInviteByEmail,
  listInvites,
  createInvite,
  updateInviteStatus,
  deleteInvite,
  getRefreshToken,
  createRefreshToken,
  deleteRefreshToken,
  deleteRefreshTokensByUserId,
  getSyncData,
  putSyncData,
  listSyncDataByPrefix,
  deleteSyncData,
  listLessons,
  getLesson,
  putLesson,
  deleteLesson,
  getCompletedLessonKBs,
  putAuditEvent,
  listAuditEvents,
};

export default db;
