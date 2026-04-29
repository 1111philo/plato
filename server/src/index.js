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
import { logger } from './lib/logger.js';
import { pluginRegistry } from './lib/plugins/registry.js';

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
    // Seed/update prompts and lessons
    try {
      const seeded = await seedDefaultContent();
      if (seeded > 0) console.log(`Seeded ${seeded} content item(s)`);
    } catch (err) {
      console.error('Seed failed (non-fatal):', err.message);
    }
    // Plugin registry: discover and activate plugins. Routes are NOT mounted here —
    // Hono throws "Can not add a route since the matcher is already built" if you
    // call server.route() mid-request. Instead we register a static catch-all (below)
    // that dispatches via the registry once it's booted.
    try {
      await pluginRegistry.boot();
    } catch (err) {
      logger.error('plugin_registry_boot_failed', { error: err?.message, stack: err?.stack });
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

// Plugin route catch-all. MUST be registered BEFORE `app` because app.js has a
// global `app.get('*')` SPA fallback that would otherwise match every unmatched
// GET (including plugin paths like /v1/plugins/slack/admin/whatever) and return
// notFound, never reaching this handler. Specific endpoints like /v1/plugins
// and /v1/plugins/extension-points on `me` are exact matches and win first.
server.all('/v1/plugins/:pluginId/*', async (c) => {
  const pluginId = c.req.param('pluginId');
  const entry = pluginRegistry.get(pluginId);
  if (!entry) return c.json({ error: 'Plugin not installed' }, 404);
  if (!entry.enabled) return c.json({ error: 'Plugin disabled' }, 404);
  if (!entry.serverModule?.routes) return c.json({ error: 'Plugin has no server routes' }, 404);
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(`/v1/plugins/${pluginId}`, '') || '/';
  return entry.serverModule.routes.fetch(new Request(url.toString(), c.req.raw));
});

// Backwards-compat shim for the legacy Slack endpoints. Before this PR Slack lived
// at /v1/admin/slack/*. Now it's a plugin at /v1/plugins/slack/admin/*. The shim
// keeps the old paths alive so any stale browser tab open during deploy keeps
// working until the user refreshes. Drop this in the next major release.
server.all('/v1/admin/slack/*', async (c) => {
  const entry = pluginRegistry.get('slack');
  if (!entry?.enabled || !entry.serverModule?.routes) {
    return c.json({ error: 'Slack integration not available' }, 404);
  }
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace('/v1/admin/slack', '/admin');
  return entry.serverModule.routes.fetch(new Request(url.toString(), c.req.raw));
});

// SPA fallback last — its `app.get('*')` would otherwise swallow plugin GETs.
server.route('/', app);

server.notFound((c) => c.json({ error: 'Not found' }, 404));

server.onError((err, c) => {
  logger.error('unhandled_error', {
    path: c.req.path,
    method: c.req.method,
    error: err?.message || String(err),
    stack: err?.stack,
  });
  return c.json({ error: 'Internal server error' }, 500);
});

// API Gateway handler (buffered — used by admin dashboard)
export const handler = handle(server);

// Function URL handler (streaming SSE responses)
export const streamHandler = streamHandle(server);
