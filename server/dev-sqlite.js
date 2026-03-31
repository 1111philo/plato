/**
 * Local dev server using SQLite — no Docker, no DynamoDB.
 * Usage: node dev-sqlite.js
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Configure SQLite backend
process.env.DB_BACKEND = 'sqlite';
process.env.SQLITE_PATH = process.env.SQLITE_PATH ?? './data/learn-service-dev.db';
process.env.SKIP_EMAIL = process.env.SKIP_EMAIL ?? 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@plato.dev';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123';
process.env.APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const { default: health } = await import('./src/routes/health.js');
const { default: auth } = await import('./src/routes/auth.js');
const { default: me } = await import('./src/routes/me.js');
const { default: admin } = await import('./src/routes/admin.js');
const { default: sync } = await import('./src/routes/sync.js');
const { default: ai } = await import('./src/routes/ai.js');
const { default: content } = await import('./src/routes/content.js');
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
  }
}

server.route('/', health);
server.route('/', auth);
server.route('/', me);
server.route('/', admin);
server.route('/', sync);
server.route('/', ai);
server.route('/', content);
server.route('/', app);

server.notFound((c) => c.json({ error: 'Not found' }, 404));
server.onError((err, c) => {
  console.error('Error:', err.message);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = parseInt(process.env.PORT || '3000');
console.log(`Learn Service (SQLite) running at http://localhost:${port}`);
console.log(`Database: ${process.env.SQLITE_PATH}`);
serve({ fetch: server.fetch, port });
