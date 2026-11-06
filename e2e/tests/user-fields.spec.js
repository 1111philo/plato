// Custom user field visibility (Blake, launch): an admin-only field and one
// kept off the public forms and the wait-list API.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

test('admins hide a field from learners or from public forms', async ({ page, browser, request }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: 'User Fields' }).click();
  const dialog = page.getByRole('dialog', { name: 'User Fields' });

  // Admin-only: hiding it from learners also turns off (and disables) Required.
  await dialog.getByLabel('Label', { exact: true }).fill('Internal note');
  await dialog.getByLabel('Required').check();
  await dialog.getByLabel('Hide from learners').check();
  await expect(dialog.getByLabel('Required')).toBeDisabled();
  await expect(dialog.getByLabel('Required')).not.toBeChecked();
  await expect(dialog.getByLabel('Hide from public forms and the wait-list API')).toBeChecked();
  await expectAccessible(page, { include: '[role=dialog]', label: 'user fields visibility' });
  await dialog.getByRole('button', { name: 'Add field' }).click();
  const list = dialog.getByRole('list', { name: 'Custom user fields' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Internal note' })).toContainText('Admins only');

  // Off the public forms only.
  await dialog.getByLabel('Label', { exact: true }).fill('Cohort code');
  await dialog.getByLabel('Hide from public forms and the wait-list API').check();
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Cohort code' })).toContainText('Not on public forms');

  // Public forms list neither; the learner's Settings shows only the second.
  const { userFields } = await (await request.get('/v1/user-fields')).json();
  expect(userFields.map((f) => f.label)).not.toContain('Internal note');
  expect(userFields.map((f) => f.label)).not.toContain('Cohort code');
  const learner = await (await browser.newContext()).newPage();
  await login(learner, LEARNER);
  await learner.goto('/settings');
  await expect(learner.getByLabel('Cohort code')).toBeVisible({ timeout: 15_000 });
  await expect(learner.getByLabel('Internal note')).toHaveCount(0);

  // Clean up for the other tests.
  for (const name of ['Internal note', 'Cohort code']) {
    page.once('dialog', (d) => d.accept());
    await list.getByRole('button', { name: `Delete field ${name}` }).click();
    const confirm = page.getByRole('alertdialog');
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /Delete/ }).click();
    await expect(list.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  }
});
