// First and last names (#402): an inferred split is flagged until corrected.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

test('a learner corrects an inferred name split in Settings; the admin sees it', async ({ page }) => {
  // create-dev-user stores a single name, so the parts are inferred ('auto').
  await login(page, LEARNER);
  await page.goto('/settings');
  const first = page.getByLabel('First name');
  const last = page.getByLabel(/^Last name/);
  await expect(first).toHaveValue('Lee', { timeout: 15_000 });
  await expect(last).toHaveValue('Learner');
  await expect(first).toHaveAccessibleDescription(/Split automatically/);
  await expectAccessible(page, { label: 'settings names' });

  await last.fill('Learner-Smith');
  const form = page.locator('form', { has: first });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved!');
  await expect(page.getByText(/Split automatically/)).toHaveCount(0);

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: 'Edit Lee Learner-Smith' }).click();
  await expect(page.getByLabel('First name')).toHaveValue('Lee');
  await expect(page.getByLabel(/^Last name/)).toHaveValue('Learner-Smith');
  await expect(page.getByText(/Split automatically/)).toHaveCount(0);

  // Put the fixture name back through Edit User, for the specs that follow.
  await page.getByLabel(/^Last name/).fill('Learner');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('User updated.');
  await expect(page.getByRole('button', { name: `Edit ${LEARNER.name}`, exact: true })).toBeVisible();
});
