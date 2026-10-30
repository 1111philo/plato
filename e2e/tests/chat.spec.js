// Composing while the coach replies, and the send-key preference (#247).
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { LEARNER, LESSONS } from '../fixtures.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('the learner can write the next message while the coach replies, and sends it after', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[0].id}`);
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/);

  await composer.fill('MOCK_SLOW here is my first example');
  await composer.press(`${MOD}+Enter`);
  // The reply streams for ~2 s; the composer stays editable meanwhile.
  await expect(composer).toBeEnabled();
  await composer.fill('My next thought');
  await expect(composer).toHaveAccessibleDescription('Send when the reply finishes');
  await expect(page.getByRole('button', { name: 'Send' }).last()).toBeDisabled();
  await composer.press(`${MOD}+Enter`); // blocked, the draft stays
  await expect(composer).toHaveValue('My next thought');

  await expect(page.getByText(/Can you give a specific example/).first()).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveAccessibleDescription(/Enter to send/);
  await composer.press(`${MOD}+Enter`);
  await expect(composer).toHaveValue('');
  await expect(page.locator('[data-chat-message="user"]', { hasText: 'My next thought' })).toHaveCount(1);
});

test('choosing Enter to send in Settings applies to the chat', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/settings');
  const chat = page.locator('[data-slot=card]', { has: page.getByText('Send a message with') });
  await chat.getByRole('radio', { name: /^Enter/ }).check();
  await expect(chat.getByRole('status')).toHaveText('Saved.');
  // Reduced motion is on in this suite, so instant replies default on.
  await expect(chat.getByRole('checkbox', { name: /Show coach replies instantly/ })).toBeChecked();
  await expectAccessible(page, { label: 'settings chat preferences' });

  await page.goto(`/lessons/${LESSONS[0].id}`);
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await expect(composer).toHaveAccessibleDescription('Enter to send, Shift+Enter for a new line');
  await composer.fill('Line one');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('line two');
  await expect(composer).toHaveValue('Line one\nline two');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(page.locator('[data-chat-message="user"]', { hasText: 'line two' })).toHaveCount(1);

  // Back to the default for the specs that follow.
  await page.goto('/settings');
  await page.getByRole('radio', { name: /^(⌘|Ctrl)\+Enter/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
});
