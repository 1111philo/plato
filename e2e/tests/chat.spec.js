// Composing while the coach replies, and the send-key preference (#247).
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

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
  // Replies show as they stream in; there's no typing-animation option.
  await expect(chat.getByRole('checkbox', { name: /Show coach replies instantly/ })).toHaveCount(0);
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

// #451 tester QA: a reply without its tags used to record nothing. The client
// asks for the tags in a second call.
test('a coach reply that comes back without its tags still records progress', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/lessons/getting-started-behind');
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await composer.fill('MOCK_NOTAGS here is my answer');
  await composer.press(`${MOD}+Enter`);
  await expect(page.locator('[data-chat-message="assistant"]')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Overview \([1-9] of 3 Objectives\): lesson panel$/ }).first()).toBeVisible({ timeout: 20_000 });
});

// #438: the lesson panel's Overview tab (merged with "Your work"), by keyboard,
// with the checklist the coach fills in. The header button says how many are met.
test('the lesson panel shows the objectives met so far, where you are, and shared work', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[2].id}`);
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/, { timeout: 20_000 });
  // One answer, so the coach (mock) checks off the first objective.
  await composer.fill('Here is an example');
  await composer.press(`${MOD}+Enter`);
  await expect(page.getByText(/Can you give a specific example/)).toBeVisible({ timeout: 20_000 });

  const open = page.getByRole('button', { name: 'Overview (1 of 4 Objectives): lesson panel' }).first();
  await expect(open).toHaveText('Overview (1 of 4 Objectives)');
  await expect(page.getByRole('button', { name: 'Your work' })).toHaveCount(0);
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#lesson-panel');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: LESSONS[2].name })).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const objectives = dialog.getByRole('list', { name: 'Objectives' }).getByRole('listitem');
  await expect(objectives).toHaveCount(4);
  await expect(objectives.first()).toContainText(', met');
  await expect(objectives.nth(1)).toContainText(', not yet');
  await expect(dialog.getByRole('heading', { name: 'What finished work looks like' })).toHaveCount(1);
  await expect(dialog.getByRole('heading', { name: 'Where you are' })).toBeVisible();
  await dialog.locator('summary', { hasText: 'Shared work' }).click();
  await expect(dialog.getByText(/Nothing shared yet/)).toBeVisible();
  await expectAccessible(page, { include: '#lesson-panel', label: 'lesson panel (started)' });
  await dialog.locator('summary', { hasText: 'Shared work' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  // "Your progress" on the lessons page links here with ?view=overview.
  await page.goto(`/lessons/${LESSONS[2].id}?view=overview`);
  await expect(page.locator('#lesson-panel').getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
});

// #451 review H1/M10: a reply cut off at max_tokens isn't saved; the draft comes back.
test('a cut-off coach reply shows an error and gives the message back to retry', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[1].id}`);
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/, { timeout: 20_000 });
  await composer.fill('MOCK_TRUNCATE my answer');
  await composer.press(`${MOD}+Enter`);
  await expect(page.getByRole('alert').filter({ hasText: 'The reply was cut off' })).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue('MOCK_TRUNCATE my answer');
  await expect(page.locator('[data-chat-message="user"]', { hasText: 'MOCK_TRUNCATE' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your message' }).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-chat-message="user"]', { hasText: 'MOCK_TRUNCATE' })).toHaveCount(0);
});

test('a failed turn comes back ahead of a draft typed meanwhile', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[1].id}`);
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/, { timeout: 20_000 });
  await composer.fill('MOCK_SLOW MOCK_TRUNCATE my long answer');
  await composer.press(`${MOD}+Enter`);
  await composer.fill('ok');
  await expect(page.getByRole('alert').filter({ hasText: 'The reply was cut off' })).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue('MOCK_SLOW MOCK_TRUNCATE my long answer\n\nok');
});

// Tester feedback on #451: after "Continue to Next Lesson" the previous
// lesson's chat showed in the next one. Same route, new :lessonGroupId; the
// next lesson here hasn't been started, the case where its opening reply
// was appended to the old messages.
test('moving to another lesson never shows the previous lesson’s chat', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[0].id}`);
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/, { timeout: 20_000 });
  const oldText = 'A message only lesson one has';
  await composer.fill(oldText);
  await composer.press(`${MOD}+Enter`);
  await expect(page.locator('[data-chat-message="user"]', { hasText: oldText })).toBeVisible({ timeout: 20_000 });

  // Client-side navigation within the same route, like Continue to Next Lesson.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/lessons/getting-started-behind');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/lessons\/getting-started-behind$/);
  await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(oldText, { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'What plato does behind the scenes' }).first()).toBeVisible();
});

// #451 scale review H3: when the AI service is busy, Send waits out the
// server's retryAfter with a visible countdown, and the message comes back.
test('a busy AI service holds Send with a countdown and gives the message back', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, LEARNER);
  await page.goto('/lessons/getting-started-sharing');
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/, { timeout: 20_000 });
  await composer.fill('MOCK_THROTTLE my answer');
  await composer.press(`${MOD}+Enter`);
  // One quiet retry first (up to ~7.5 s), then the typed error.
  await expect(page.getByRole('alert').filter({ hasText: 'plato is busy right now' })).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue('MOCK_THROTTLE my answer');
  await expect(page.getByTestId('send-cooldown')).toContainText(/You can send again in \d+ seconds?/);
  await expect(page.getByRole('status').filter({ hasText: /plato is busy\. You can send again in \d+ seconds\./ })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Send' }).last()).toBeDisabled();
  await expect(composer).toHaveAccessibleDescription('Send when plato is ready again');
  await expectAccessible(page, { label: 'chat with send cooldown' });
  await expect(page.getByTestId('send-cooldown')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('status').filter({ hasText: 'You can send again.' })).toBeAttached();
});
