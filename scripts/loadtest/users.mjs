#!/usr/bin/env node
/**
 * Create, count, and delete load-test accounts directly in a stack's
 * DynamoDB tables, using the server's own db and password code.
 *
 *   node scripts/loadtest/users.mjs create <count>   # loadtest+001@example.com …
 *   node scripts/loadtest/users.mjs count            # test rows left in every table
 *   node scripts/loadtest/users.mjs delete           # users, sync-data, refresh tokens, audit rows
 *
 * Env: STACK_PREFIX (default `plato-playground`) names the tables
 * (`<prefix>-users`, …), the same names the Lambda gets as USERS_TABLE etc.
 * It refuses the prod prefix (`plato`). AWS credentials come from the usual
 * chain (AWS_PROFILE, AWS_REGION).
 *
 * Accounts are recognisable three ways, and delete requires all three:
 * userId `usr_loadtest_NNN`, email `loadtest+NNN@example.com`, name
 * `Load Test NNN`. `create` writes the shared password and the account list
 * to scripts/loadtest/.out/users.json (gitignored) for the k6 scripts.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..', '..', 'server');
const prefix = process.env.STACK_PREFIX || 'plato-playground';
if (prefix === 'plato' || !prefix.startsWith('plato-')) {
  console.error(`Refusing STACK_PREFIX=${prefix}: load tests never run against prod.`);
  process.exit(1);
}
Object.assign(process.env, {
  DB_BACKEND: 'dynamodb',
  USERS_TABLE: `${prefix}-users`,
  INVITES_TABLE: `${prefix}-invites`,
  REFRESH_TOKENS_TABLE: `${prefix}-refresh-tokens`,
  SYNC_DATA_TABLE: `${prefix}-sync-data`,
  AUDIT_LOG_TABLE: `${prefix}-audit-log`,
});

const db = (await import(join(serverDir, 'src/lib/db.js'))).default;
const { hashPassword } = await import(join(serverDir, 'src/lib/password.js'));
const req = createRequire(join(serverDir, 'package.json'));
const { DynamoDBClient } = await import(req.resolve('@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = await import(req.resolve('@aws-sdk/lib-dynamodb'));
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const pad = (n) => String(n).padStart(3, '0');
const ID_RE = /^usr_loadtest_\d{3,}$/;
const EMAIL_RE = /^loadtest\+\d{3,}@example\.com$/;
const isTestUser = (u) => ID_RE.test(u.userId || '') && EMAIL_RE.test(u.email || '') && /^Load Test \d{3,}$/.test(u.name || '');

async function scanAll(TableName, opts = {}) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await doc.send(new ScanCommand({ TableName, ExclusiveStartKey, ...opts }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

async function testUsers() {
  const rows = await scanAll(process.env.USERS_TABLE, {
    FilterExpression: 'begins_with(userId, :p)',
    ExpressionAttributeValues: { ':p': 'usr_loadtest_' },
  });
  return rows.filter(isTestUser);
}

async function create(count) {
  const password = `lt-${randomBytes(12).toString('hex')}`;
  const passwordHash = await hashPassword(password); // one hash, shared
  const users = [];
  for (let n = 1; n <= count; n++) {
    users.push({ userId: `usr_loadtest_${pad(n)}`, email: `loadtest+${pad(n)}@example.com`, username: `loadtest-${pad(n)}`, name: `Load Test ${pad(n)}` });
  }
  for (const u of users) {
    if (await db.getUserByEmail(u.email)) throw new Error(`${u.email} already exists; run delete first`);
  }
  let made = 0;
  await pool(users, 25, async (u) => {
    await db.createUser({ ...u, passwordHash, userGroup: null, role: 'user', slackUserId: null });
    made++;
  });
  mkdirSync(join(here, '.out'), { recursive: true });
  writeFileSync(join(here, '.out', 'users.json'), JSON.stringify({ password, users: users.map((u) => u.email) }, null, 1));
  console.log(`created ${made} users in ${process.env.USERS_TABLE}; credentials in scripts/loadtest/.out/users.json`);
}

async function counts() {
  const users = await testUsers();
  const ids = new Set(users.map((u) => u.userId));
  const sync = await scanAll(process.env.SYNC_DATA_TABLE, {
    FilterExpression: 'begins_with(userId, :p)', ExpressionAttributeValues: { ':p': 'usr_loadtest_' }, ProjectionExpression: 'userId, dataKey',
  });
  const tokens = await scanAll(process.env.REFRESH_TOKENS_TABLE, {
    FilterExpression: 'begins_with(userId, :p)', ExpressionAttributeValues: { ':p': 'usr_loadtest_' }, ProjectionExpression: 'tokenHash, userId',
  });
  const audit = await scanAll(process.env.AUDIT_LOG_TABLE, {
    FilterExpression: 'begins_with(userId, :p)', ExpressionAttributeValues: { ':p': 'usr_loadtest_' }, ProjectionExpression: 'logId, userId',
  });
  return { users, ids, sync, tokens, audit };
}

async function del() {
  const { users, sync, tokens, audit } = await counts();
  const ok = (row) => ID_RE.test(row.userId || '');
  await pool(sync.filter(ok), 25, (r) => db.deleteSyncData(r.userId, r.dataKey));
  await pool(tokens.filter(ok), 25, (r) => doc.send(new DeleteCommand({ TableName: process.env.REFRESH_TOKENS_TABLE, Key: { tokenHash: r.tokenHash } })));
  await pool(audit.filter(ok), 25, (r) => doc.send(new DeleteCommand({ TableName: process.env.AUDIT_LOG_TABLE, Key: { logId: r.logId } })));
  await pool(users, 25, (u) => db.deleteUser(u.userId));
  console.log(`deleted users=${users.length} sync-data=${sync.length} refresh-tokens=${tokens.length} audit-log=${audit.length}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'create') await create(Number(arg) || 900);
else if (cmd === 'delete') await del();
else if (cmd === 'count') {
  const { users, sync, tokens, audit } = await counts();
  // Any loadtest-looking email that didn't match all three markers, so a
  // half-created row can't hide from delete.
  const loose = await scanAll(process.env.USERS_TABLE, {
    FilterExpression: 'begins_with(email, :e)', ExpressionAttributeValues: { ':e': 'loadtest+' }, ProjectionExpression: 'userId, email',
  });
  console.log(`${prefix}: users=${users.length} (loadtest+ emails=${loose.length}) sync-data=${sync.length} refresh-tokens=${tokens.length} audit-log=${audit.length}`);
} else {
  console.error('usage: users.mjs create <count> | count | delete');
  process.exit(1);
}
process.exit(0);
