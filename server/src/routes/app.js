import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const app = new Hono();

// ── Serve React client from built files ──

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Load built client files into memory at startup
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDistDir = join(__dirname, '../../../client/dist');
const staticFiles = {};
function loadDir(dir, prefix) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const urlPath = prefix + entry.name;
      if (entry.isDirectory()) {
        loadDir(fullPath, urlPath + '/');
      } else {
        staticFiles[urlPath] = {
          content: readFileSync(fullPath),
          type: MIME_TYPES[extname(entry.name)] || 'application/octet-stream',
        };
      }
    }
  } catch { /* dist dir may not exist in tests */ }
}
loadDir(clientDistDir, '/');

const indexHtml = staticFiles['/index.html'];

// Serve static assets with long-term caching
app.get('/assets/*', (c) => {
  const file = staticFiles[c.req.path];
  if (!file) return c.notFound();
  c.header('Content-Type', file.type);
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(file.content);
});

// ── API endpoints (public, no auth) ──

app.get('/v1/affiliations', async (c) => {
  const db = (await import('../lib/db.js')).default;
  const item = await db.getSyncData('_system', 'settings');
  return c.json({ affiliations: item?.data?.affiliations || [] });
});

app.get('/v1/invite-example.csv', (c) => {
  const csv = 'email\njane@example.com\ncarlos@example.com\naisha@example.com\n';
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="invite-example.csv"');
  return c.body(csv);
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (c) => {
  // Don't intercept API routes
  if (c.req.path.startsWith('/v1/')) return c.notFound();

  // Try to serve a static file first (for css, js, images, etc.)
  const file = staticFiles[c.req.path];
  if (file) {
    c.header('Content-Type', file.type);
    return c.body(file.content);
  }

  // SPA fallback: serve index.html for all other routes
  if (!indexHtml) return c.text('Client not built. Run: cd client && npm run build', 500);
  c.header('Content-Type', indexHtml.type);
  return c.body(indexHtml.content);
});

export default app;
