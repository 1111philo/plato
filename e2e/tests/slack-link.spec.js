// Admin → Users with the Slack plugin connected: the Slack filter and
// Update… → Slack link. Slack itself is stubbed: the plugins list reports
// Slack connected, and the link route returns a canned result.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, EDUCATOR, TESTER } from '../fixtures.js';

test('admins filter by Slack link and link selected accounts', async ({ page }) => {
  await page.route('**/v1/admin/plugins', async (route) => {
    const res = await route.fetch();
    const list = await res.json();
    const slack = list.find((p) => p.id === 'slack');
    if (slack) { slack.enabled = true; slack.settings = { ...slack.settings, connected: true, workspaceName: 'Test' }; }
    await route.fulfill({ response: res, json: list });
  });
  let linkBody = null;
  await page.route('**/v1/plugins/slack/admin/link', async (route) => {
    linkBody = route.request().postDataJSON();
    await route.fulfill({ json: { linked: 1, alreadyLinked: 0, notInWorkspace: 1, failed: 0 } });
  });

  await login(page, ADMIN);
  await page.goto('/plato/users');
  const table = page.getByRole('table', { name: 'Users and invites' });
  await expect(table).toBeVisible();

  // Filter: nobody is linked in the seed, so Not linked keeps every signed-up user.
  await page.getByRole('button', { name: /^Filters/ }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await menu.getByRole('menuitemcheckbox', { name: /^Not linked/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Filters on' })).toContainText('Slack: Not linked');
  await expect(table.getByRole('row').filter({ hasText: EDUCATOR.name })).toHaveCount(1);
  await page.getByRole('list', { name: 'Filters on' }).getByRole('button', { name: 'Clear all' }).click();

  // Bulk: Slack link, by keyboard.
  for (const u of [EDUCATOR, TESTER]) {
    await table.getByRole('checkbox', { name: `Select ${u.name}` }).focus();
    await page.keyboard.press('Space');
  }
  await page.getByRole('region', { name: 'Selected users' }).getByRole('button', { name: 'Update…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Update 2 users' });
  await dialog.getByLabel('What to change').selectOption({ label: 'Slack link' });
  await expect(dialog).toContainText('Links 2 users to the Slack member with the same email. Existing links stay, and nobody is added to a channel.');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await expectAccessible(page, { include: '[role=dialog]', label: 'bulk Slack link dialog' });
  await dialog.getByRole('button', { name: 'Link 2 users' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Linked 1 user to Slack. 1 not found in Slack by email.' })).toBeVisible();
  expect(linkBody.userIds).toHaveLength(2);
});
