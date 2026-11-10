// Admin → Lessons (#526, #527): filter by course, select lessons, make them
// private and share them with someone, then make them public again, by
// keyboard where it matters. Testers see the filters but can't select.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, TESTER, PROGRAM, LESSONS } from '../fixtures.js';

const [ONE, TWO] = LESSONS;

test('admins filter lessons by course and change visibility in bulk', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/lessons');
  const table = page.getByRole('table', { name: 'Lessons' });
  const rowOf = (name) => table.getByRole('row').filter({ hasText: name });
  await expect(rowOf(ONE.name)).toBeVisible();

  // Filter: Course.
  await page.getByRole('button', { name: /^Filters/ }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectAccessible(page, { label: 'lessons filters menu' });
  await menu.getByRole('menuitemcheckbox', { name: new RegExp(`^${PROGRAM.name}(?! ›)`) }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Filters on' })).toContainText(`Course: ${PROGRAM.name}`);
  await expect(page.getByRole('status').filter({ hasText: /^\d+ of \d+ lessons$/ })).toBeVisible();

  try {
    // Select two lessons by keyboard, then make them private and share them.
    for (const l of [ONE, TWO]) {
      await table.getByRole('checkbox', { name: `Select ${l.name}` }).focus();
      await page.keyboard.press('Space');
    }
    const bar = page.getByRole('region', { name: 'Selected lessons' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Update…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Update 2 lessons' });
    await expect(dialog.getByRole('radio', { name: 'Private' })).toBeChecked();
    await dialog.getByLabel('Search people').fill('Lee');
    await dialog.getByRole('checkbox', { name: `Share with ${LEARNER.name}` }).check();
    await expect(dialog).toContainText('Makes 2 lessons private and shares them with 1 person, added to who they’re already shared with.');
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectAccessible(page, { include: '[role=dialog]', label: 'bulk lessons dialog' });
    await dialog.getByRole('button', { name: 'Update 2 lessons' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Made private and shared with 1 person: 2 lessons.' })).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expect(rowOf(ONE.name)).toContainText('Private (1)');
    await expect(rowOf(TWO.name)).toContainText('Private (1)');
  } finally {
    // Back to public (also exercises the public path).
    await page.getByRole('checkbox', { name: 'Select all lessons shown' }).check();
    await page.getByRole('region', { name: 'Selected lessons' }).getByRole('button', { name: 'Update…' }).click();
    const dialog = page.getByRole('dialog', { name: /^Update \d+ lessons$/ });
    await dialog.getByRole('radio', { name: 'Public' }).check();
    await dialog.getByRole('button', { name: /^Update \d+ lessons$/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: /^Made public: 2 lessons\./ })).toBeVisible();
  }
  await expect(rowOf(ONE.name)).toContainText('Public');
});

test('testers can filter lessons but not select them', async ({ page }) => {
  await login(page, TESTER);
  await page.goto('/plato/lessons');
  await expect(page.getByRole('table', { name: 'Lessons' }).getByRole('row').filter({ hasText: ONE.name })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select all lessons shown' })).toHaveCount(0);
});
