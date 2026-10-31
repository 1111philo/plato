// Someone with an account joins the wait list, an admin invites them, and
// they accept in the classroom: the entry's group merges into the account (#363).
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, INVITEE } from '../fixtures.js';
import { BASE_URL } from '../playwright.config.js';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

test('an invite to an existing account is accepted from the lessons list', async ({ page }) => {
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: true });
  await api('POST', '/v1/waitlist', null, { name: INVITEE.name, email: INVITEE.email, userGroup: 'Cohort A' });
  const { entries } = await api('GET', '/v1/admin/waitlist', admin);
  const entry = entries.find((e) => e.email === INVITEE.email);
  expect(entry.alreadyRegistered).toBe('account');
  const sent = await api('POST', `/v1/admin/waitlist/${entry.inviteToken}/invite`, admin);
  expect(sent.existingAccount).toBe(true);
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: false });

  await login(page, INVITEE);
  const notice = page.getByRole('region', { name: 'You’re invited' });
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText('Accepting adds the group Cohort A to your account.');
  await expectAccessible(page, { label: 'account invite notice' });

  const accept = notice.getByRole('button', { name: 'Accept' });
  await accept.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Invite accepted' })).toHaveText(/Invite accepted/);
  await expect(notice).toBeHidden();

  const users = await api('GET', '/v1/admin/users', admin);
  expect(users.find((u) => u.email === INVITEE.email).userGroup).toBe('Cohort A');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'You’re invited' })).toHaveCount(0);
});
