// axe on every page and dialog: no serious/critical WCAG 2.1 A/AA violations.
// Runs on desktop and mobile viewports (playwright.config.js projects).
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Loading...', { exact: true })).toHaveCount(0, { timeout: 15_000 });
}

test.describe('public pages', () => {
  for (const path of ['/login', '/forgot-password', '/waitlist', '/signup', '/how-assessment-works', '/privacy']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await expectAccessible(page, { label: path });
    });
  }
});

test('error banner (failed sign-in) has readable contrast', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email or username/i).fill('nobody@example.com');
  await page.locator('input[type=password]').fill('wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expectAccessible(page, { label: 'login error banner' });
});

test.describe('learner pages', () => {
  test.beforeEach(async ({ page }) => { await login(page, LEARNER); });

  test('/lessons', async ({ page }) => {
    await settle(page);
    await expect(page.getByText(LESSONS[0].name).first()).toBeVisible();
    await expectAccessible(page, { label: '/lessons' });
  });

  test('lesson outline dialog', async ({ page }) => {
    await settle(page);
    await page.getByRole('button', { name: /view outline/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectAccessible(page, { include: '[role=dialog]', label: 'outline dialog' });
  });

  test('/lessons/:id while the coach streams and after', async ({ page }) => {
    await page.goto(`/lessons/${LESSONS[0].id}`);
    await expect(page.getByRole('log')).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, { label: 'lesson chat (streaming)' });
    await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
    await settle(page);
    await expectAccessible(page, { label: 'lesson chat' });
  });

  test('lesson overview dialog fits the viewport and scrolls once', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/lessons/${LESSONS[2].id}`);
    await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Lesson Overview/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    // Exactly one scroll area: the global dialog cap must not add a second
    // scrollbar around LessonChat's own inner scroll region.
    const scrollers = await dialog.evaluate((el) => [el, ...el.querySelectorAll('*')]
      .filter((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)).length);
    expect(scrollers).toBe(1);
    // Keyboard scrolling: focus the overview region and page down to the end.
    const region = dialog.getByRole('region', { name: 'Lesson overview' });
    await region.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('PageDown');
    await expect(page.getByText('Exemplar paragraph 40', { exact: false })).toBeInViewport();
    await expectAccessible(page, { include: '[role=dialog]', label: 'lesson overview dialog' });
  });

  test('/settings', async ({ page }) => {
    await page.goto('/settings');
    await settle(page);
    await expectAccessible(page, { label: '/settings' });
  });

  test('dialog: sign out', async ({ page }) => {
    await page.goto('/lessons');
    await settle(page);
    await page.getByRole('button', { name: /account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectAccessible(page, { include: '[role=alertdialog]', label: 'sign out dialog' });
  });
});

test.describe('admin pages', () => {
  test.beforeEach(async ({ page }) => { await login(page, ADMIN); });

  for (const path of ['/plato', '/plato/lessons', '/plato/lessons/structure', `/plato/lessons/${LESSONS[0].id}/edit`, '/plato/users', '/plato/notifications', '/plato/customizer', '/plato/customizer/knowledge', '/plato/plugins', '/plato/lessons/new']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await expectAccessible(page, { label: path });
    });
  }

  test('/plato/users/:id (edit user)', async ({ page }) => {
    await page.goto('/plato/users');
    await settle(page);
    await page.getByRole('button', { name: `Edit ${LEARNER.name}` }).click();
    await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
    await settle(page);
    await expectAccessible(page, { label: 'edit user' });
  });

  test('dialog: lesson visibility & sharing', async ({ page }) => {
    await page.goto('/plato/lessons');
    await settle(page);
    await page.getByRole('button', { name: `Visibility and sharing for ${LESSONS[0].name}` }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectAccessible(page, { include: '[role=dialog]', label: 'share lesson dialog' });
  });

  for (const [path, button] of [
    ['/plato/users', 'Invite Users'], ['/plato/users', 'User Groups'], ['/plato/users', 'User Fields'],
    ['/plato/users', 'Wait List'],
  ]) {
    test(`dialog: ${button}`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await page.getByRole('button', { name: button }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, { include: '[role=dialog]', label: `${button} dialog` });
    });
  }
});
