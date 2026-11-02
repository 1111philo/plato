// Getting Started ships with plato (#443) as a course of three lessons. On a
// new classroom it's public and shown first. "How assessment works" is linked
// from the lesson overview.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';

const COURSE = 'Getting Started with plato';
const LESSON_IDS = ['getting-started', 'getting-started-sharing', 'getting-started-behind'];

test('learners find the Getting Started course first, in order, and the coach opens it', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/lessons');
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings.first()).toHaveText(COURSE, { timeout: 15_000 });
  const lessons = page.getByRole('list', { name: 'How plato works lessons' }).getByRole('button', { name: /^Open lesson / });
  await expect(lessons).toHaveCount(3);
  await expect(lessons.nth(0)).toHaveAccessibleName(/^Open lesson Welcome to plato/);
  await expect(lessons.nth(1)).toHaveAccessibleName(/^Open lesson Sharing your work/);
  await expect(lessons.nth(2)).toHaveAccessibleName(/^Open lesson What plato does behind the scenes/);
  await expectAccessible(page, { label: 'lessons with the getting started course' });

  await lessons.nth(0).click();
  await expect(page).toHaveURL(/\/lessons\/getting-started$/);
  await expect(page.getByRole('button', { name: /^Progress \(\d of 3 Objectives\): lesson overview$/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
});

test('admins are asked to publish a private Getting Started course, and can publish it in one step', async ({ page, request }) => {
  const { accessToken } = await (await request.post('/v1/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })).json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const setStatus = (id, status) => request.put(`/v1/admin/lessons/${id}`, { headers: auth, data: { status } });
  for (const id of LESSON_IDS) expect((await setStatus(id, 'private')).ok()).toBe(true); // as on an upgraded classroom

  await login(page, ADMIN);
  await page.goto('/plato/lessons');
  const notices = page.getByRole('list', { name: 'Lessons that ship with plato' });
  await expect(notices).toContainText(`The ${COURSE} course was added to show learners how plato works`);
  await expect(notices.getByRole('listitem')).toHaveCount(1);
  await expectAccessible(page, { label: 'bundled course notice' });
  await notices.getByRole('button', { name: 'Publish all 3' }).click();
  await expect(notices).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Published' })).toBeVisible();

  const list = await (await request.get('/v1/admin/lessons', { headers: auth })).json();
  const rows = Array.isArray(list) ? list : list.lessons;
  for (const id of LESSON_IDS) expect(rows.find((l) => l.lessonId === id).status).toBe('public');
});

test('"How assessment works" is in the lesson overview, next to Close', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/lessons/getting-started');
  await page.getByRole('button', { name: /^Progress \(\d of 3 Objectives\): lesson overview$/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'How assessment works' })).toBeVisible();
  await expectAccessible(page, { include: '[role=dialog]', label: 'lesson overview with assessment link' });
  await dialog.getByRole('link', { name: 'How assessment works' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'How assessment works' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'When a lesson is complete' })).toBeVisible();
  await expectAccessible(page, { label: 'how assessment works' });
});
