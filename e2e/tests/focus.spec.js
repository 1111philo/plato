// Visible keyboard focus (WCAG 2.4.7) on the main pages: every element Tab
// reaches shows an outline, a ring/shadow, or (for a bare textarea) a ring on
// its box. This caught a global focus rule the browser silently dropped
// (`hsl()` around an oklch color), which left most of plato with no focus ring.
import { test, expect } from '@playwright/test';
import { login } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

async function unfocusable(page, path, tabs = 40) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const bad = new Set();
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press('Tab');
    const miss = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const shows = (n) => {
        const cs = getComputedStyle(n);
        return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      };
      let n = el;
      for (let up = 0; n && up < 3; up++, n = n.parentElement) if (shows(n)) return null;
      return `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.innerText || '').slice(0, 40).replace(/\n/g, ' ')}"`;
    });
    if (miss) bad.add(miss);
  }
  return [...bad];
}

test('learner pages show keyboard focus', async ({ page }) => {
  await login(page, LEARNER);
  for (const path of ['/lessons', '/settings', `/lessons/${LESSONS[0].id}`]) {
    expect(await unfocusable(page, path), path).toEqual([]);
  }
});

test('admin pages show keyboard focus', async ({ page }) => {
  await login(page, ADMIN);
  for (const path of ['/plato', '/plato/lessons', '/plato/users', '/plato/notifications', '/plato/lessons/structure']) {
    expect(await unfocusable(page, path), path).toEqual([]);
  }
});
