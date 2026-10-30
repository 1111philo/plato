// Seed the e2e server through its real API (plus the dev helper for a
// learner account): a course, lessons in it, custom user fields, a group.
import { execFileSync } from 'node:child_process';
import { BASE_URL, DB_PATH } from './playwright.config.js';
import { ADMIN, LEARNER, EDUCATOR, TESTER, LESSONS, COURSE, PROGRAM } from './fixtures.js';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

export default async function globalSetup() {
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  await api('PUT', `/v1/admin/programs/${PROGRAM.id}`, admin, { name: PROGRAM.name });
  await api('PUT', `/v1/admin/units/${COURSE.id}`, admin, { name: COURSE.name, programId: PROGRAM.id });
  for (const l of LESSONS) {
    await api('PUT', `/v1/admin/lessons/${l.id}`, admin, { name: l.name, markdown: l.markdown, status: 'public', course: COURSE.id });
  }
  await api('PUT', '/v1/admin/groups', admin, { name: 'Cohort A' });
  await api('POST', '/v1/admin/user-fields', admin, { label: 'Organization', type: 'text', required: false });
  for (const u of [LEARNER, EDUCATOR, TESTER]) {
    execFileSync(process.execPath, ['scripts/create-dev-user.js', u.email, u.password, u.name], {
      cwd: new URL('../server/', import.meta.url),
      env: { ...process.env, DB_BACKEND: 'sqlite', SQLITE_PATH: DB_PATH },
      stdio: 'ignore',
    });
  }
  // Staff roles go through the real role endpoint (#435).
  const users = await api('GET', '/v1/admin/users', admin);
  for (const u of [EDUCATOR, TESTER]) {
    const { userId } = users.find((x) => x.email === u.email);
    await api('PUT', `/v1/admin/users/${userId}/role`, admin, { role: u.role });
  }
}
