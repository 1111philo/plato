/**
 * Database router — selects DynamoDB or SQLite backend based on DB_BACKEND env var.
 */

const backend = process.env.DB_BACKEND || 'dynamodb';

let db;
if (backend === 'sqlite') {
  const mod = await import('./db-sqlite.js');
  db = mod.default;
} else {
  const mod = await import('./db-dynamodb.js');
  db = mod.default;
}

export default db;
