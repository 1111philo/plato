/**
 * Creates DynamoDB tables on a local DynamoDB instance.
 * Run: node scripts/setup-local-db.js
 * Requires: docker run -p 8000:8000 amazon/dynamodb-local
 */
import { DynamoDBClient, CreateTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

const tables = [
  {
    TableName: 'plato-users',
    KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'email-index',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
    }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'plato-invites',
    KeySchema: [{ AttributeName: 'inviteToken', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'inviteToken', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'email-index',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
    }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'plato-refresh-tokens',
    KeySchema: [{ AttributeName: 'tokenHash', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'tokenHash', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'plato-sync-data',
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'dataKey', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'dataKey', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'plato-audit-log',
    KeySchema: [{ AttributeName: 'logId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'logId', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

const existing = await client.send(new ListTablesCommand({}));
for (const table of tables) {
  if (existing.TableNames?.includes(table.TableName)) {
    console.log(`  exists: ${table.TableName}`);
    continue;
  }
  await client.send(new CreateTableCommand(table));
  console.log(`  created: ${table.TableName}`);
}
console.log('Done.');
