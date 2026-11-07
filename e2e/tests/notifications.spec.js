// Admin → Notifications (#388, #389): compose, automations, history.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, TESTER } from '../fixtures.js';

test('an admin sends a classroom message to everyone and sees it in History', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato');
  await page.getByRole('navigation').getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Goes to \d+ (person|people)/ })).toBeVisible();
  await expectAccessible(page, { label: 'notifications compose' });

  // (No pop-up here: every later spec's learner would get it. The pop-up has
  // its own test, aimed at one learner, in notifications-learner.spec.js.)
  await page.getByLabel('Subject').fill('Welcome, {{firstName}}');
  await page.getByLabel('Message').fill('The classroom is open.\n\nSay hi to your coach.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('goes out in the classroom now');
  await confirm.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('tab', { name: 'History', selected: true })).toBeVisible();
  const row = page.getByRole('table', { name: 'Sent messages' }).getByRole('row').nth(1);
  await expect(row).toContainText('Welcome, {{firstName}}');
  await expect(row).toContainText('Everyone');
  await expectAccessible(page, { label: 'notifications history' });
});

test('automations start off; the wait list email is editable and validated', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/notifications');
  await page.getByRole('tab', { name: 'Automations' }).click();
  const toggle = page.getByLabel('Send the wait list confirmation email');
  await expect(toggle).not.toBeChecked();
  await expectAccessible(page, { label: 'notifications automations' });

  const card = page.locator('[data-slot=card]', { has: page.getByText('Wait list confirmation', { exact: true }) });
  const subject = card.getByLabel('Subject');
  await subject.fill('Thanks {{lessonName}}');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Unknown variable: \{\{lessonName\}\}/).first()).toBeVisible();
  await subject.fill('Thanks for joining, {{firstName}}');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Email saved.').first()).toBeVisible();
  await card.getByRole('button', { name: 'Use the default' }).click();
  await expect(subject).toHaveValue("You're on the wait list for {{classroomName}}");

  await toggle.check();
  await expect(page.getByText('Wait list confirmation is on.').first()).toBeVisible();
  await toggle.uncheck();
  await expect(page.getByText('Wait list confirmation is off.').first()).toBeVisible();
  // The scheduled ones are listed too, also off.
  await expect(page.getByLabel('Send the inactivity reminder email')).not.toBeChecked();
  await expect(page.getByLabel('Send the weekly digest email')).not.toBeChecked();
});

// Blake's review on #451: everyone means every role, and messages can go by role.
test('a message can go to chosen roles; the count follows', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/notifications');
  const count = page.getByRole('status').filter({ hasText: /^Goes to \d+ (person|people)/ });
  await expect(count).toBeVisible();
  const everyone = Number((await count.textContent()).match(/\d+/)[0]);

  await page.getByLabel('By role').check();
  const roles = page.getByRole('group', { name: 'Roles' });
  await expect(roles).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled(); // no role chosen yet
  await roles.getByLabel('Admins').check();
  await expect(count).toHaveText(/^Goes to 1 person/);
  await expectAccessible(page, { label: 'notifications compose by role' });
  await roles.getByLabel('Learners').check();
  await expect(count).not.toHaveText(/^Goes to 1 person/);
  const some = Number((await count.textContent()).match(/\d+/)[0]);
  expect(some).toBeLessThan(everyone); // educators and testers aren't included
});

test('invitations are always on and editable; removal from the wait list starts off', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/notifications');
  await page.getByRole('tab', { name: 'Automations' }).click();
  for (const title of ['Invitation', 'Invitation (existing account)']) {
    const card = page.locator('[data-slot=card]', { has: page.getByText(title, { exact: true }) });
    await expect(card.getByText('Always on')).toBeVisible();
    await expect(card.getByRole('checkbox')).toHaveCount(0);
    await expect(card.getByLabel('Subject')).not.toHaveValue('');
  }
  const removed = page.getByLabel('Send the removed from the wait list email');
  await expect(removed).not.toBeChecked();
  await removed.check();
  await expect(page.getByText('Removed from the wait list is on.').first()).toBeVisible();
  await removed.uncheck();
  await expect(page.getByText('Removed from the wait list is off.').first()).toBeVisible();
});

test('testers can look at Notifications but not send', async ({ page }) => {
  await login(page, TESTER);
  await page.goto('/plato/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(page.getByText('Only admins can send messages.')).toBeVisible();
});
