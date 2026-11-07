// Reflow (WCAG 1.4.10): at 320 CSS px wide (400% zoom on a 1280 px screen)
// no page scrolls sideways. Data tables may scroll inside their own container.
import { test, expect } from '@playwright/test';
import { login } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.use({ viewport: { width: 320, height: 640 } });

test('learner pages reflow at 320 px', async ({ page }) => {
  for (const path of ['/login', '/waitlist', '/how-assessment-works']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await overflow(page), path).toBeLessThanOrEqual(1);
  }
  await login(page, LEARNER);
  for (const path of ['/lessons', '/settings', `/lessons/${LESSONS[0].id}`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    expect(await overflow(page), path).toBeLessThanOrEqual(1);
  }
});

test('admin pages reflow at 320 px (tables scroll inside themselves)', async ({ page }) => {
  await login(page, ADMIN);
  for (const path of ['/plato', '/plato/lessons', '/plato/lessons/structure', '/plato/users', '/plato/notifications', '/plato/customizer', '/plato/plugins']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    expect(await overflow(page), path).toBeLessThanOrEqual(1);
  }
});
