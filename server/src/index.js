import { Hono } from 'hono';
import { handle, streamHandle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';
import health from './routes/health.js';
import auth from './routes/auth.js';
import me from './routes/me.js';
import admin from './routes/admin.js';
import sync from './routes/sync.js';
import ai from './routes/ai.js';
import content from './routes/content.js';
import app from './routes/app.js';
import db from './lib/db.js';
import { generateUserId } from './lib/crypto.js';
import { hashPassword } from './lib/password.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './config.js';
import { seedDefaultContent } from './lib/seed.js';
import { migrateCoursesToLessons } from './lib/migrate.js';

const server = new Hono();

server.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// First-request initialization: admin bootstrap, content seeding
let initChecked = false;
server.use('*', async (c, next) => {
  if (!initChecked) {
    initChecked = true;
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
    // Migrate course → lesson data keys (idempotent)
    try {
      const migrated = await migrateCoursesToLessons();
      if (migrated > 0) console.log(`Migrated ${migrated} course → lesson key(s)`);
    } catch (err) {
      console.error('Migration failed (non-fatal):', err.message);
    }
    // Seed/update prompts and lessons
    try {
      const seeded = await seedDefaultContent();
      if (seeded > 0) console.log(`Seeded ${seeded} content item(s)`);
    } catch (err) {
      console.error('Seed failed (non-fatal):', err.message);
    }
  }
  await next();
});

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
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// API Gateway handler (buffered — used by admin dashboard)
export const handler = handle(server);

// Function URL handler (streaming SSE responses)
export const streamHandler = streamHandle(server);
