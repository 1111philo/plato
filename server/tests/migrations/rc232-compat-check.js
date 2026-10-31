/**
 * Child-process helper for upgrade-from-rc232.test.js: load Beta-RC-232's
 * actual route handlers (extracted from the git tag into `argv[2]`) against
 * the migrated SQLite db at SQLITE_PATH, and report what an RC-232 server
 * would serve. If a migration ever breaks rollback to RC-232, this is where
 * it shows up.
 *
 * Prints one JSON line: { results: { [label]: { status, count? } } }.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Hono } from 'hono';

const src = process.argv[2];
const load = async (rel) => (await import(pathToFileURL(join(src, rel)).href)).default;
const { signAccessToken } = await import(pathToFileURL(join(src, 'lib/jwt.js')).href);

const app = new Hono();
for (const route of ['routes/auth.js', 'routes/me.js', 'routes/admin.js', 'routes/sync.js', 'routes/content.js']) {
  app.route('/', await load(route));
}

const adminToken = await signAccessToken('usr_admin', 'admin');
const learnerToken = await signAccessToken('usr_ada', 'user');

const checks = [
  ['admin users', adminToken, '/v1/admin/users?include=stats', (b) => b.length],
  ['admin lessons', adminToken, '/v1/admin/lessons', (b) => b.length],
  ['admin courses', adminToken, '/v1/admin/courses', (b) => (b.courses || b).length],
  ['admin settings', adminToken, '/v1/admin/settings', (b) => (b.userGroups || []).length],
  ['admin waitlist', adminToken, '/v1/admin/waitlist', (b) => b.entries.length],
  ['admin user detail', adminToken, '/v1/admin/users/usr_ada', () => null],
  ['learner me', learnerToken, '/v1/me', () => null],
  ['learner fields', learnerToken, '/v1/me/fields', (b) => b.missing.length],
  ['learner lessons', learnerToken, '/v1/lessons', (b) => (b.lessons || b).length],
  ['learner lesson', learnerToken, '/v1/lessons/les-f1', () => null],
  ['learner sync', learnerToken, '/v1/sync', (b) => Object.keys(b.items || b).length],
  ['learner kb', learnerToken, '/v1/sync/lessonKB:les-f1', (b) => b.data?.progress],
];

const results = {};
for (const [label, token, path, count] of checks) {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  results[label] = { status: res.status, count: res.ok && body ? count(body) : undefined };
}
process.stdout.write(JSON.stringify({ results }) + '\n');
process.exit(0);
