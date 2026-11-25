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
  for (const path of ['/login', '/forgot-password', '/waitlist', '/signup', '/privacy']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await expectAccessible(page, { label: path });
    });
  }
});

// Where single sign-on returns to (docs/SSO.md). The exchange is answered
// here so every screen is checked at both sizes; tests/sso.spec.js runs the
// real flow.
test.describe('/sso/complete', () => {
  const label = 'Sign in with UIC';
  const person = { email: 'nova@sso.example.edu', firstName: 'Nova', lastName: 'Newcomer' };
  const screens = [
    ['no account, wait list open', { outcome: 'no_account', onWaitlist: false, waitlistOpen: true, ticket: 't', label, ...person }, 'You don’t have an account yet'],
    ['no account, wait list closed', { outcome: 'no_account', onWaitlist: false, waitlistOpen: false, ticket: 't', label, ...person }, 'You don’t have an account yet'],
    ['on the wait list', { outcome: 'no_account', onWaitlist: true, waitlistOpen: true, ticket: null, label, ...person }, 'You’re on the wait list'],
    ['error', { outcome: 'error', code: 'identity_in_use', label }, 'We couldn’t sign you in'],
    ['expired', null, 'That sign-in link has expired'],
  ];
  for (const [name, outcome, heading] of screens) {
    test(name, async ({ page }) => {
      await page.route('**/v1/auth/sso/exchange', (route) => (outcome
        ? route.fulfill({ json: outcome })
        : route.fulfill({ status: 400, json: { code: 'sso_expired' } })));
      await page.goto(`/sso/complete#code=a11y-${name.replace(/[^a-z]/g, '-')}`);
      await expect(page.getByRole('heading', { name: heading })).toBeFocused();
      await settle(page);
      await expectAccessible(page, { label: `/sso/complete: ${name}` });
    });
  }

  test('while signing in', async ({ page }) => {
    await page.route('**/v1/auth/sso/exchange', () => {}); // never answers
    await page.goto('/sso/complete#code=a11y-pending-0000');
    await expect(page.getByRole('status').filter({ hasText: 'Signing you in…' })).toBeVisible();
    await expectAccessible(page, { label: '/sso/complete: signing in' });
  });
});

test('error banner (failed sign-in) has readable contrast', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email or username/i).fill('nobody@example.com');
  await page.locator('input[type=password]').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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

  test('the lesson panel fits the viewport and scrolls once', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/lessons/${LESSONS[2].id}`);
    await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /^Overview \(\d+ of \d+ Objectives\): lesson panel$/ }).first().click();
    const dialog = page.locator('#lesson-panel');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    // Exactly one scroll area: the Overview tab's own (the global dialog cap,
    // on narrow screens, must not add a second around it).
    const scrollers = await dialog.evaluate((el) => [el, ...el.querySelectorAll('*')]
      .filter((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)).length);
    expect(scrollers).toBe(1);
    // Keyboard scrolling: focus the Overview tab's panel and page down to the end.
    const region = dialog.getByRole('tabpanel', { name: 'Overview' });
    await region.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('PageDown');
    await expect(page.getByText('Exemplar paragraph 40', { exact: false })).toBeInViewport();
    await expectAccessible(page, { include: '#lesson-panel', label: 'lesson panel' });
  });

  test('/settings', async ({ page }) => {
    await page.goto('/settings');
    await settle(page);
    await expectAccessible(page, { label: '/settings' });
  });

  // Trace mode (#595): docked beside the chat on a wide screen, a dialog on a
  // narrow one. Both projects run this, so both forms are checked.
  test('the lesson trace', async ({ page }) => {
    // The lesson panel's Trace tab, recording; Stop trace leaves it as it was.
    await page.goto(`/lessons/${LESSONS[0].id}`);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /: lesson panel$/ }).click();
    const panel = page.locator('#lesson-panel');
    await panel.getByRole('tab', { name: 'Data Trace' }).click();
    await panel.getByRole('button', { name: 'Start trace' }).click();
    await expect(panel.getByRole('heading', { name: /^Exchanges/ })).toBeVisible();
    await expectAccessible(page, { include: '#lesson-panel', label: 'lesson trace' });
    await expectAccessible(page, { label: 'lesson chat with the trace open' });
    await panel.getByRole('button', { name: 'Stop trace' }).click();
    await expect(panel.getByRole('button', { name: 'Start trace' })).toBeVisible();
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
