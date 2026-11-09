// Changing the password (#451 scale review S2): it needs the current one, and
// it signs out every other device while this one stays signed in.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { PASSWORD_USER } from '../fixtures.js';

test('changing the password needs the current one and signs out other devices', async ({ page, browser }) => {
  const other = await (await browser.newContext()).newPage();
  await login(other, PASSWORD_USER);
  await login(page, PASSWORD_USER);
  await page.goto('/settings');

  const current = page.getByLabel('Current Password', { exact: true });
  await expect(current).toBeVisible({ timeout: 15_000 });
  await expectAccessible(page, { label: 'settings with current password' });

  const change = async (from, to) => {
    await current.fill(from);
    await page.getByLabel('New Password', { exact: true }).fill(to);
    await page.getByLabel('Confirm Password', { exact: true }).fill(to);
    await page.getByRole('button', { name: 'Change Password' }).click();
  };

  await change('wrong-password', 'a-brand-new-one');
  await expect(page.getByRole('status').filter({ hasText: 'Your current password is incorrect' })).toBeVisible();

  await change(PASSWORD_USER.password, 'a-brand-new-one');
  await expect(page.getByRole('status').filter({ hasText: 'Password changed. Other devices are signed out.' })).toBeVisible();

  // This device is still signed in (it got a fresh session) ...
  await page.reload();
  await expect(current).toBeVisible({ timeout: 15_000 });
  // ... and the other device's session has ended.
  const status = await other.evaluate(async () => {
    const { accessToken } = JSON.parse(localStorage.getItem('plato_auth'));
    return (await fetch('/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } })).status;
  });
  expect(status).toBe(401);

  // Put it back for reruns.
  await change('a-brand-new-one', PASSWORD_USER.password);
  await expect(page.getByRole('status').filter({ hasText: 'Password changed.' })).toBeVisible();
});
