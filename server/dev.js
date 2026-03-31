import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Point DynamoDB at local instance
process.env.AWS_REGION = 'us-east-1';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
process.env.SKIP_EMAIL = process.env.SKIP_EMAIL ?? 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
process.env.APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

// Patch DynamoDB client to use local endpoint
const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const originalSend = DynamoDBClient.prototype.send;
// We'll override in db.js via endpoint config instead — see below.

const { default: health } = await import('./src/routes/health.js');
const { default: auth } = await import('./src/routes/auth.js');
const { default: me } = await import('./src/routes/me.js');
const { default: admin } = await import('./src/routes/admin.js');
const { default: sync } = await import('./src/routes/sync.js');
const { default: ai } = await import('./src/routes/ai.js');
const { default: app } = await import('./src/routes/app.js');
const { default: db } = await import('./src/lib/db.js');
const { generateUserId } = await import('./src/lib/crypto.js');
const { hashPassword } = await import('./src/lib/password.js');
const { ADMIN_EMAIL, ADMIN_PASSWORD } = await import('./src/config.js');

const server = new Hono();

server.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Admin bootstrap
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  try {
    const count = await db.countUsers();
    if (count === 0) {
      const userId = generateUserId();
      const passwordHash = await hashPassword(ADMIN_PASSWORD);
      await db.createUser({
        userId,
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        name: 'Admin',
        role: 'admin',
      });
      console.log(`Admin bootstrapped: ${ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error('Admin bootstrap failed:', err.message);
    console.error('Is DynamoDB Local running? docker run -p 8000:8000 amazon/dynamodb-local');
  }
}

server.route('/', health);
server.route('/', auth);
server.route('/', me);
server.route('/', admin);
server.route('/', sync);
server.route('/', ai);
server.route('/', app);

server.notFound((c) => c.json({ error: 'Not found' }, 404));
server.onError((err, c) => {
  console.error('Error:', err.message);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = parseInt(process.env.PORT || '3000');
console.log(`plato server running at http://localhost:${port}`);
serve({ fetch: server.fetch, port });
