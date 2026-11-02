// Courses & Units (#408): build structure and reorder with the keyboard only.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, PROGRAM, COURSE, LESSONS } from '../fixtures.js';

test('admin builds and orders the Course → Unit → Lesson structure by keyboard', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/lessons');
  await page.getByRole('button', { name: 'Courses & Units' }).click();
  await expect(page.getByRole('heading', { name: 'Courses & Units' })).toBeVisible();
  await expect(page.getByRole('heading', { name: PROGRAM.name })).toBeVisible();

  // Add a second unit to the seeded course.
  const course = page.locator('[data-slot=card]', { has: page.getByRole('heading', { name: PROGRAM.name }) });
  await course.getByRole('button', { name: 'Add unit' }).click();
  await page.keyboard.type('Second Unit');
  await page.keyboard.press('Enter');
  const units = page.getByRole('list', { name: `Units in ${PROGRAM.name}` });
  await expect(units.getByRole('button', { name: /^Second Unit ·/ })).toBeVisible();

  // Move it above the first unit; focus stays on the control, and the move is announced.
  const moveUp = page.getByRole('button', { name: 'Move Second Unit up' });
  await moveUp.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Moved Second Unit up.' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Move Second Unit down' })).toBeFocused();
  const order = await units.locator(':scope > li').allInnerTexts();
  expect(order[0]).toContain('Second Unit');

  // Expand the seeded unit and reorder its lessons.
  await page.getByRole('button', { name: new RegExp(`^${COURSE.name} ·`) }).click();
  const lessons = page.getByRole('list', { name: `Lessons in ${COURSE.name}` });
  await expect(lessons).toBeVisible();
  const first = (await lessons.locator('li').first().innerText());
  await page.getByRole('button', { name: `Move ${LESSONS[1].name} up` }).click();
  await expect(lessons.locator('li').first()).toContainText(LESSONS[1].name);
  expect(first).toContain(LESSONS[0].name);

  await expectAccessible(page, { label: 'courses & units' });
});

test('the lesson editor offers units grouped by course', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto(`/plato/lessons/${LESSONS[0].id}/edit`);
  const picker = page.getByLabel('Unit', { exact: true });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(picker.locator('optgroup', { hasText: COURSE.name })).toHaveAttribute('label', PROGRAM.name);
  await expect(picker).toHaveValue(COURSE.id);
});

// Runs after the reorder above (workers: 1, file order), so the learner sees
// the admin's order, not name order.
test('learners see lessons grouped by course and unit, in the admin-defined order', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/lessons');
  await expect(page.getByRole('heading', { level: 2, name: PROGRAM.name })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 3, name: COURSE.name })).toBeVisible();
  const cards = page.getByRole('list', { name: `${COURSE.name} lessons` }).getByRole('button', { name: /^Open lesson / });
  await expect(cards).toHaveCount(LESSONS.length);
  const names = await cards.evaluateAll((els) => els.map((e) => e.querySelector('span').textContent.replace(/^Open lesson /, '')));
  expect(names).toEqual([LESSONS[1].name, LESSONS[0].name, LESSONS[2].name]);
  await expect(page.getByLabel('Course', { exact: true })).toHaveValue('all');
  await expectAccessible(page, { label: 'lessons by course and unit' });
});
