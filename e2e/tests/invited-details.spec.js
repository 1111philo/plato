// An invite made from the wait list keeps showing the person's name, group,
// and answers in Admin → Users while it's pending (#571), and User Groups
// counts them apart as "invited".
import { test, expect } from '@playwright/test';
import { login } from '../helpers.js';
import { ADMIN } from '../fixtures.js';

test('an invited wait-list person keeps their name and group in Users, and counts as invited in User Groups', async ({ page }) => {
  const api = async (method, path, token, body) => {
    const res = await page.request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
    expect(res.ok(), `${method} ${path}`).toBe(true);
    return res.json();
  };
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  const email = 'kept-details@example.com';
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: true });
  await api('POST', '/v1/waitlist', null, { name: 'Kept Details', email, userGroup: 'Cohort A' });
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: false });
  const { entries } = await api('GET', '/v1/admin/waitlist', admin);
  await api('POST', `/v1/admin/waitlist/${entries.find((e) => e.email === email).inviteToken}/invite`, admin);
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    const row = page.getByRole('table', { name: 'Users and invites' }).getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('Kept Details');
    await expect(row).toContainText('Cohort A');
    await expect(row).toContainText('Invited');
    await page.getByRole('button', { name: 'User Groups' }).first().click();
    await expect(page.getByRole('dialog')).toContainText(/Cohort A.*· 1 invited/s);
  } finally {
    for (const i of (await api('GET', '/v1/admin/invites', admin)).filter((x) => x.email === email)) {
      await page.request.fetch(`/v1/admin/invites/${i.inviteToken}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
    }
  }
});
