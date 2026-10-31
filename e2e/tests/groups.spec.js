// User Groups (#434): add, rename (with duplicate check), delete with confirm.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN } from '../fixtures.js';

test('admins add, rename, and delete groups; errors show in the dialog', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: 'User Groups' }).click();
  const dialog = page.getByRole('dialog', { name: 'User Groups' });
  const list = dialog.getByRole('list', { name: 'Groups' });

  await dialog.getByLabel('New group name').fill('Temp Group');
  await dialog.getByLabel('New group name').press('Enter');
  await expect(list.getByRole('listitem').filter({ hasText: 'Temp Group' })).toBeVisible();
  const names = await list.getByRole('listitem').allInnerTexts();
  expect(names.map((n) => n.split('\n')[0])).toEqual([...names.map((n) => n.split('\n')[0])].sort((a, b) => a.localeCompare(b)));
  await expectAccessible(page, { include: '[role=dialog]', label: 'groups dialog' });

  await dialog.getByRole('button', { name: 'Rename group Temp Group' }).click();
  const input = dialog.getByLabel('New name for Temp Group');
  await expect(input).toBeFocused();
  await input.fill('cohort a');
  await input.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('A group with that name already exists');
  await input.fill('Renamed Group');
  await input.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Renamed Temp Group to Renamed Group.');

  await dialog.getByRole('button', { name: 'Delete group Renamed Group' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('will no longer be in a group');
  await confirm.getByRole('button', { name: 'Delete group' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Renamed Group' })).toHaveCount(0);
});
