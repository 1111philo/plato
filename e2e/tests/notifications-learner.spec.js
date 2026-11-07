// The learner side of messages (#389, #400): the sign-in pop-up, the bell,
// and email settings.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

test('an important message pops up once, then lives in the bell', async ({ page, request }) => {
  const { accessToken } = await (await request.post('/v1/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })).json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const users = await (await request.get('/v1/admin/users', { headers: auth })).json();
  const learner = users.find((u) => u.email === LEARNER.email);
  const sent = await request.post('/v1/admin/notifications/messages', {
    headers: auth,
    data: { subject: 'Office hours, {{firstName}}', body: 'Join us Thursday.\n\nBring a question.', inApp: true, important: true, audience: { type: 'users', userIds: [learner.userId] } },
  });
  expect(sent.status()).toBe(201);

  await login(page, LEARNER);
  const popup = page.getByRole('dialog', { name: 'Office hours, Lee' });
  await expect(popup).toBeVisible({ timeout: 15_000 });
  await expect(popup).toContainText('Bring a question.');
  await expectAccessible(page, { include: '[role=dialog]', label: 'message pop-up' });
  await popup.getByRole('button', { name: 'Got it' }).click();
  await expect(popup).toBeHidden();

  // Reload: read, so no pop-up again; the bell has it.
  await page.reload();
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await bell.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Office hours, Lee/ })).toBeVisible();
  await expectAccessible(page, { label: 'notifications menu' });
  await page.keyboard.press('Escape');
  await expect(bell).toHaveAccessibleName(/^Notifications(, \d+ unread)?$/);
});

test('learners choose which emails they get', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/settings');
  const digest = page.getByRole('checkbox', { name: 'A weekly summary of my progress and new lessons' });
  await expect(digest).toBeChecked();
  await digest.uncheck();
  const card = page.locator('[data-slot=card]', { has: page.getByText('Email me') });
  await expect(card.getByRole('status')).toHaveText('Saved.');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'A weekly summary of my progress and new lessons' })).not.toBeChecked();
  await expectAccessible(page, { label: 'settings email' });
  await page.getByRole('checkbox', { name: 'A weekly summary of my progress and new lessons' }).check();
});
