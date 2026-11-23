// Trace mode (#595): a learner turns it on, runs a lesson, and reads what
// plato did behind it. Wide screens dock the Trace beside the chat.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const LESSON = `/lessons/${LESSONS[1].id}`;

async function setTrace(page, on) {
  await page.goto('/settings');
  const box = page.getByRole('checkbox', { name: 'Record what plato does behind my conversations' });
  await expect(box).toBeEnabled();
  if ((await box.isChecked()) !== on) {
    await box.focus();
    await page.keyboard.press('Space');
    const card = page.locator('[data-slot=card]', { has: box });
    await expect(card.getByRole('status')).toHaveText('Saved.');
  }
  await expect(box).toBeChecked({ checked: on });
}

async function say(page, text) {
  const composer = page.getByRole('textbox', { name: 'Your message' }).last();
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.fill(text);
  await composer.press(`${MOD}+Enter`);
  await expect(composer).toHaveValue('');
}

test.describe('Trace mode', () => {
  test.afterEach(async ({ page }) => { await setTrace(page, false); });

  test('off by default: no Trace button; on: the lesson is recorded and readable by keyboard', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, false);
    await page.goto(LESSON);
    await expect(page.getByText(/Welcome! In this lesson/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^Trace/ })).toHaveCount(0);

    await setTrace(page, true);
    await expectAccessible(page, { label: 'settings with trace mode on' });

    // Start the lesson again so its trace is complete.
    await page.goto(LESSON);
    await expect(page.getByText(/Welcome! In this lesson/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Reset lesson' }).first().click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: /reset/i }).click();
    await page.waitForURL(/\/lessons$/);
    await page.goto(LESSON);
    await expect(page.getByText(/Welcome! In this lesson/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-chat-message="assistant"]')).toHaveCount(1);

    const trace = page.getByRole('button', { name: 'Trace: what plato did behind this conversation' });
    await expect(trace).toBeVisible();
    await expect(trace).toHaveAttribute('aria-expanded', 'false');
    await trace.focus();
    await page.keyboard.press('Enter');

    // Docked beside the chat: a landmark, not a dialog, and the chat still works.
    const panel = page.getByRole('complementary', { name: 'Trace' });
    await expect(panel).toBeVisible();
    await expect(trace).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('heading', { name: 'Trace', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: /^Lesson start/ })).toBeVisible();

    await say(page, 'My first answer about the key idea.');
    await expect(page.getByText(/Can you give a specific example/).first()).toBeVisible({ timeout: 20_000 });
    const turn = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Your message: “My first answer/ }) }).first();
    await expect(turn).toBeVisible({ timeout: 20_000 });
    await expect(turn.getByText('The AI model').first()).toBeVisible();
    await expect(turn.getByText(/plato’s code changed nothing/)).toBeVisible();

    // Every step, with the exact text behind it.
    await turn.getByRole('button', { name: /^Show all \d+ steps$/ }).click();
    await expect(turn.getByRole('heading', { name: 'What you sent' })).toBeVisible();
    await expect(turn.getByRole('heading', { name: 'Coach: reply' })).toBeVisible();
    await expect(turn.getByText('plato’s code').first()).toBeVisible();
    await turn.getByText('The model’s raw reply').first().click();
    await expect(turn.locator('details[open] pre').filter({ hasText: /\[PROGRESS: \d+\]/ }).first()).toBeVisible();
    await turn.getByText(/^Instructions: The agent’s instructions/).first().click();
    await expect(turn.locator('details[open] pre').filter({ hasText: 'AGENT: Coach' }).first()).toBeVisible();
    await expectAccessible(page, { label: 'lesson chat with the trace docked and a turn open' });

    // The pinned header and composer leave room for the panel.
    const panelBox = await panel.boundingBox();
    const composerBox = await page.getByRole('textbox', { name: 'Your message' }).last().boundingBox();
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(panelBox.x + 1);

    // Escape closes it from inside and focus returns to the button.
    await panel.getByRole('region', { name: 'Trace steps' }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trace).toBeFocused();
  });

  test('a held completion is explained: flagged, who decided, before and after', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, true);
    await page.goto(LESSON);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    const replies = page.locator('[data-chat-message="assistant"]');
    const before = await replies.count();
    await say(page, 'MOCK_COMPLETE MOCK_UNBACKED I think I am done');
    await expect(replies).toHaveCount(before + 1, { timeout: 30_000 });

    // From the reply: "Behind this response" opens the trace at that turn.
    const behind = page.getByRole('button', { name: /^Behind this response/ }).last();
    await behind.click();
    await page.getByRole('button', { name: 'Open the trace for this reply' }).last().click();
    const panel = page.getByRole('complementary', { name: 'Trace' });
    await expect(panel.getByRole('heading', { name: 'Things worth a look' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /completion was held/ })).toBeVisible();
    const turn = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Your message: “MOCK_COMPLETE MOCK_UNBACKED/ }) }).first();
    await expect(turn.getByRole('heading', { name: /^Your message/ })).toBeFocused();
    await expect(turn.getByText(/plato’s code changed the result/)).toBeVisible();
    await expect(turn.getByRole('heading', { name: 'The assessment check’s verdict' })).toBeVisible();
    await expect(turn.getByText(/^Rule:/).first()).toBeVisible();
    await expect(turn.getByText('Before', { exact: true }).first()).toBeVisible();
    await expectAccessible(page, { include: '#lesson-trace', label: 'trace with a held completion open' });
  });

  test('narrow screens get the trace as a dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page, LEARNER);
    await setTrace(page, true);
    await page.goto(LESSON);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Trace: what plato did behind this conversation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Trace' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expectAccessible(page, { include: '[role=dialog]', label: 'trace dialog (narrow)' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('View as User: an admin reads the learner’s trace, read-only', async ({ page }) => {
    // The learner records a turn.
    await login(page, LEARNER);
    await setTrace(page, true);
    await page.goto(LESSON);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    const replies = page.locator('[data-chat-message="assistant"]');
    const before = await replies.count();
    await say(page, 'A turn for my teacher to read.');
    await expect(replies).toHaveCount(before + 1, { timeout: 30_000 });
    await setTrace(page, false);
    await page.getByRole('button', { name: /account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);

    // The admin's own Trace mode is off; the learner's lesson still offers its trace.
    await login(page, ADMIN);
    await page.goto('/lessons');
    await page.getByRole('button', { name: 'View as user' }).click();
    await page.getByRole('textbox', { name: 'Search users' }).fill('Lee');
    await page.getByRole('button', { name: /^View as Lee Learner/ }).click();
    await expect(page.getByText('Viewing as').first()).toBeVisible({ timeout: 20_000 });
    const writes = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && /\/v1\/(sync|ai)/.test(r.url())) writes.push(`${r.method()} ${r.url()}`); });
    await page.goto(LESSON);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Trace: what plato did behind this conversation' }).click();
    const panel = page.getByRole('complementary', { name: 'Trace' });
    await expect(panel.getByRole('heading', { name: /^Your message: “A turn for my teacher/ })).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText('Trace mode is off now, so new messages aren’t recorded.')).toBeVisible();
    await expectAccessible(page, { include: '#lesson-trace', label: 'trace in View as User' });
    expect(writes).toEqual([]);
    await page.getByRole('button', { name: /^Exit viewing as/ }).click();
  });

  test('Technology and services, and downloading the trace', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, true);
    await page.goto(LESSON);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Trace: what plato did behind this conversation' }).click();
    const panel = page.getByRole('complementary', { name: 'Trace' });
    await expect(panel.getByRole('heading', { name: 'Timeline' })).toBeVisible();

    // Download, by keyboard (enabled once the trace has loaded).
    await expect(panel.getByRole('button', { name: 'Download as text' })).toBeEnabled();
    const [text] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download as text' }).press('Enter')]);
    expect(text.suggestedFilename()).toBe(`plato-trace-${LESSONS[1].id}.txt`);
    const [json] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download the data (JSON)' }).click()]);
    expect(json.suggestedFilename()).toBe(`plato-trace-${LESSONS[1].id}.json`);

    // The Technology tab: arrow keys move between tabs, Enter opens one.
    await panel.getByRole('tab', { name: 'Timeline' }).focus();
    await page.keyboard.press('ArrowRight');
    const tech = panel.getByRole('tab', { name: 'Technology and services' });
    await expect(tech).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tech).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('heading', { name: 'Used by this classroom' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Amazon Bedrock' })).toBeVisible();
    await expect(panel.getByText('This install is using a stand-in model for testing, not a real AI model.')).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Not turned on here' })).toBeVisible();
    await expectAccessible(page, { include: '#lesson-trace', label: 'trace technology tab' });
  });
});
