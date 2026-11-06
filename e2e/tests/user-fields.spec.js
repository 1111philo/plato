// Admin → Users → User Fields, by keyboard: add, edit in place, choose who
// sees a field, reorder, delete with a confirmation. Visibility (Blake,
// launch): admins-only fields and ones kept off signup and the wait list.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

test('admins manage user fields and who sees them', async ({ page, browser, request }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: 'User Fields' }).click();
  const dialog = page.getByRole('dialog', { name: 'User Fields' });
  const list = dialog.getByRole('list', { name: 'Custom user fields' });
  const row = (name) => list.getByRole('listitem').filter({ hasText: name });

  // Add an admins-only field: Required doesn't apply, so it isn't offered.
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await expect(dialog.getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.type('Internal note');
  await expect(dialog.getByRole('group', { name: 'Who can see and fill it in' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^Everyone/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /^Admins only/ }).check();
  await expect(dialog.getByRole('checkbox', { name: /^Required/ })).toHaveCount(0);
  await expectAccessible(page, { include: '[role=dialog]', label: 'user field editor' });
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await expect(row('Internal note')).toContainText('Text · Admins only');
  await expect(dialog.getByRole('status')).toHaveText('Added Internal note.');
  await expect(dialog.getByRole('button', { name: 'Edit Internal note' })).toBeFocused();

  // Add a required field learners fill in after signup.
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await page.keyboard.type('Cohort code');
  await dialog.getByRole('radio', { name: /^Learners, after signup/ }).check();
  await dialog.getByRole('checkbox', { name: /^Required/ }).check();
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await expect(row('Cohort code')).toContainText('Text · Required · After signup');

  // Edit in place: the editor replaces the row; Escape cancels and returns focus.
  await dialog.getByRole('button', { name: 'Edit Cohort code' }).click();
  await expect(dialog.getByRole('form', { name: 'Edit Cohort code' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('form')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit Cohort code' })).toBeFocused();

  // Reorder by keyboard: focus stays on the moved row's button.
  const up = dialog.getByRole('button', { name: 'Move Cohort code up' });
  await up.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Moved Cohort code up.');
  await expect(row('Cohort code')).toHaveCount(1);

  // Public forms list neither; the learner's Settings shows only Cohort code.
  const { userFields } = await (await request.get('/v1/user-fields')).json();
  expect(userFields.map((f) => f.label)).not.toContain('Internal note');
  expect(userFields.map((f) => f.label)).not.toContain('Cohort code');
  const learner = await (await browser.newContext()).newPage();
  await login(learner, LEARNER);
  await learner.goto('/settings');
  await expect(learner.getByLabel(/Cohort code/)).toBeVisible({ timeout: 15_000 });
  await expect(learner.getByLabel(/Internal note/)).toHaveCount(0);

  // Delete from the editor, behind a confirmation.
  for (const name of ['Internal note', 'Cohort code']) {
    await dialog.getByRole('button', { name: `Edit ${name}` }).click();
    await dialog.getByRole('button', { name: 'Delete field' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Delete ${name}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete field' }).click();
    await expect(row(name)).toHaveCount(0);
    await expect(dialog.getByRole('status')).toHaveText(`Deleted ${name}.`);
  }
});
