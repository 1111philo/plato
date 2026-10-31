// Admin tables (#362, #385, #386): combined filters, the Columns dialog, User ID.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

const headers = (page, table) => page.getByRole('table', { name: table }).getByRole('columnheader').allInnerTexts();

test('Users: combine filters by keyboard, see them as chips, clear them', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  const table = page.getByRole('table', { name: 'Users and invites' });
  await expect(table).toBeVisible();
  const total = await table.getByRole('row').count();

  await page.getByRole('button', { name: /^Filters/ }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectAccessible(page, { label: 'users filters menu' });
  await menu.getByRole('menuitemcheckbox', { name: /^Learner/ }).click();
  await menu.getByRole('menuitemcheckbox', { name: /^Signed up/ }).click();
  await expect(menu).toBeVisible(); // stays open while choosing
  await page.keyboard.press('Escape');

  const chips = page.getByRole('list', { name: 'Filters on' });
  await expect(chips).toContainText('Role: Learner');
  await expect(chips).toContainText('Status: Signed up');
  await expect(page.getByRole('button', { name: /^Filters, 2 on/ })).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'Educator' })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: LEARNER.email })).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: /^\d+ of \d+ people$/ })).toBeVisible();

  await chips.getByRole('button', { name: 'Remove the Role filter' }).click();
  await expect(chips).not.toContainText('Role:');
  await chips.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('list', { name: 'Filters on' })).toHaveCount(0);
  await expect(table.getByRole('row')).toHaveCount(total);
});

test('Users: choose and order columns; the User ID column shows the account id; layout persists', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await expect(page.getByRole('table', { name: 'Users and invites' }).getByRole('cell', { name: /^usr_/ }).first()).toBeVisible();
  expect((await headers(page, 'Users and invites')).at(-2)).toMatch(/User ID/);

  await page.getByRole('button', { name: 'Columns' }).click();
  const dialog = page.getByRole('dialog', { name: 'Users table columns' });
  await expectAccessible(page, { include: '[role=dialog]', label: 'columns dialog' });
  await dialog.getByRole('checkbox', { name: 'Email' }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Organization' }).check(); // a custom field, hidden by default
  const up = dialog.getByRole('button', { name: 'Move User ID up' });
  await up.click();
  await expect(up).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText('Moved User ID up.');
  await dialog.getByRole('button', { name: 'Done' }).click();

  let cols = await headers(page, 'Users and invites');
  expect(cols.some((c) => /^Email/.test(c))).toBe(false);
  expect(cols.some((c) => /Organization/.test(c))).toBe(true);
  expect(cols.findIndex((c) => /User ID/.test(c))).toBeLessThan(cols.findIndex((c) => /Organization/.test(c)));

  await page.reload();
  cols = await headers(page, 'Users and invites');
  expect(cols.some((c) => /^Email/.test(c))).toBe(false);

  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  cols = await headers(page, 'Users and invites');
  expect(cols.some((c) => /^Email/.test(c))).toBe(true);
});

test('Lessons: the Columns dialog shows the hidden Lesson ID column', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/lessons');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('dialog', { name: 'Lessons table columns' }).getByRole('checkbox', { name: 'Lesson ID' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('table', { name: 'Lessons' }).getByRole('cell', { name: 'getting-started' })).toBeVisible();
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('plato:columns:lessons:v1')) localStorage.removeItem(k); });
});
