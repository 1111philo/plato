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

// #411: every reply has a "Behind this response" disclosure.
test('learners can see which agents worked on a reply and what they did', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[2].id}`);
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
  // The opening message: the lesson planner and the coach.
  const opening = page.getByRole('button', { name: /^Behind this response/ }).first();
  await expect(opening).toHaveAccessibleName('Behind this response: Lesson planner, Coach');

  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await composer.fill('Here is an example');
  await composer.press(`${MOD}+Enter`);
  await expect(page.getByText(/Can you give a specific example/)).toBeVisible({ timeout: 20_000 });
  // The disclosure arrives with the persisted message, after the streamed text.
  await expect(page.getByRole('button', { name: /^Behind this response/ })).toHaveCount(2);
  const latest = page.getByRole('button', { name: /^Behind this response/ }).last();
  await expect(latest).toHaveAttribute('aria-expanded', 'false');
  await latest.focus();
  await page.keyboard.press('Enter');
  await expect(latest).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`[id="${await latest.getAttribute('aria-controls')}"]`);
  await expect(panel).toContainText('Progress 0 → 3 of 10');
  await expect(panel).toContainText('Mock insight after turn 1');
  await expect(panel).toContainText('Learner profile');
  await expectAccessible(page, { label: 'agent activity open' });
});

// #451 tester QA: a reply without its tags used to record nothing. The client
// asks for the tags in a second call, and says so under the reply.
test('a coach reply that comes back without its tags still records progress', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/lessons/getting-started-behind');
  await expect(page.getByText(/Welcome! In this lesson/)).toBeVisible({ timeout: 20_000 });
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await composer.fill('MOCK_NOTAGS here is my answer');
  await composer.press(`${MOD}+Enter`);
  await expect(page.getByRole('button', { name: /^Behind this response/ })).toHaveCount(2, { timeout: 20_000 });
  const latest = page.getByRole('button', { name: /^Behind this response/ }).last();
  await latest.click();
  const panel = page.locator(`[id="${await latest.getAttribute('aria-controls')}"]`);
  await expect(panel).toContainText('Recorded this reply’s progress in a second step');
  await expect(panel).toContainText(/Progress 0 → [1-9] of 10/);
  await expect(page.getByRole('button', { name: /^Progress \([1-9] of 3 Objectives\): lesson overview$/ }).first()).toBeVisible();
});

test('the lesson editor shows the lesson creator behind each reply', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/lessons/new');
  const button = page.getByRole('button', { name: /^Behind this response/ }).first();
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  await expect(page.getByText('Readiness 3 of 10')).toBeVisible();
});

// #438: the lesson overview (merged with "Your work"), by keyboard, with the
// checklist the coach fills in. The header button says how many are met.
test('the lesson overview shows the objectives met so far, where you are, and shared work', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto(`/lessons/${LESSONS[2].id}`); // continues the conversation from the test above
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toHaveAccessibleDescription(/Enter to send/, { timeout: 20_000 });

  const open = page.getByRole('button', { name: 'Progress (1 of 4 Objectives): lesson overview' }).first();
  await expect(open).toHaveText('Progress (1 of 4 Objectives)');
  await expect(page.getByRole('button', { name: 'Your work' })).toHaveCount(0);
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: LESSONS[2].name });
  await expect(dialog).toBeVisible();
  const objectives = dialog.getByRole('list', { name: 'Objectives' }).getByRole('listitem');
  await expect(objectives).toHaveCount(4);
  await expect(objectives.first()).toContainText(', met');
  await expect(objectives.nth(1)).toContainText(', not yet');
  await expect(dialog.getByRole('heading', { name: 'What finished work looks like' })).toHaveCount(1);
  await expect(dialog.getByRole('heading', { name: 'Where you are' })).toBeVisible();
  await dialog.locator('summary', { hasText: 'Shared work' }).click();
  await expect(dialog.getByText(/Nothing shared yet/)).toBeVisible();
  await expectAccessible(page, { include: '[role=dialog]', label: 'lesson overview dialog (started)' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // "Your progress" on the lessons page links here with ?view=overview.
  await page.goto(`/lessons/${LESSONS[2].id}?view=overview`);
  await expect(page.getByRole('dialog', { name: LESSONS[2].name })).toBeVisible({ timeout: 20_000 });
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
