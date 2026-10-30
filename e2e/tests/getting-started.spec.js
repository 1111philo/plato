// Getting Started ships with plato (#443): on a new classroom it's public and
// shown first, under "Start here".
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

test('learners find Getting Started first, and the coach opens it', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/lessons');
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings.first()).toHaveText('Start here', { timeout: 15_000 });
  const start = page.getByRole('list', { name: 'Start here' }).getByRole('button', { name: /^Open lesson Getting Started/ });
  await expect(start).toBeVisible();
  await expectAccessible(page, { label: 'lessons with start here' });

  await start.click();
  await expect(page).toHaveURL(/\/lessons\/getting-started$/);
  await expect(page.getByRole('button', { name: /Lesson Overview \(4 Objectives\)/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
});

test('admins are asked to publish a private Getting Started, and can dismiss it', async ({ page, request }) => {
  const { accessToken } = await (await request.post('/v1/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })).json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const setStatus = (status) => request.put('/v1/admin/lessons/getting-started', { headers: auth, data: { status } });
  expect((await setStatus('private')).ok()).toBe(true); // as on an upgraded classroom

  await login(page, ADMIN);
  await page.goto('/plato/lessons');
  const notices = page.getByRole('list', { name: 'Lessons that ship with plato' });
  await expect(notices).toContainText("Getting Started was added to show learners how lessons work. It’s private until you publish it.");
  await expectAccessible(page, { label: 'bundled lesson notice' });
  await notices.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notices).toHaveCount(0);

  expect((await setStatus('public')).ok()).toBe(true);
});
