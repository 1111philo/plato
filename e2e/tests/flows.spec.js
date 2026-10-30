// Keyboard-driven smoke flows on the real UI with the mock coach.
import { test, expect } from '@playwright/test';
import { login } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

test('learner completes a lesson using only the keyboard', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[1].id}`);
  const log = page.getByRole('log');
  await expect(log).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });

  const composer = page.getByRole('textbox', { name: /message|coach|response/i }).last();
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.focus();
  await page.keyboard.type('Here is my first example.');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect(page.getByText(/Can you give a specific example/)).toBeVisible({ timeout: 20_000 });

  // Alt+Arrow moves between messages in the log.
  await log.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator(':focus[data-chat-message]')).toHaveCount(1);

  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.focus();
  await page.keyboard.type('MOCK_COMPLETE');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect(page.getByText(/You have met every objective/)).toBeVisible({ timeout: 20_000 });
  // Next lesson follows the unit's stored order (default: by name), #408.
  await expect(page.getByRole('button', { name: `Continue to next lesson: ${LESSONS[2].name}` })).toBeVisible({ timeout: 20_000 });
});

test('admin reaches main content with the skip link', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await expect(page.getByRole('table')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('long admin dialogs fit the viewport and scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: 'User Fields' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
});
