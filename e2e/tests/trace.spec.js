// Trace (#595): a learner opens the lesson panel (the Overview button), starts
// a trace in its Trace tab, runs the lesson, and reads what plato did behind
// it; "Stop trace" ends it. Wide screens dock the panel beside the chat.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, LESSONS } from '../fixtures.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const LESSON = `/lessons/${LESSONS[1].id}`;

const savedPrefs = (page) => page.waitForResponse((r) => r.url().endsWith('/v1/sync/preferences') && r.request().method() === 'PUT');
const panelOf = (page) => page.locator('#lesson-panel');
const MARKER = 'Trace is recording this lesson: open the Trace';

/** Open the lesson panel on its Trace tab. */
async function openTraceTab(page) {
  const panel = panelOf(page);
  if (!(await panel.isVisible())) await page.getByRole('button', { name: /: lesson panel$/ }).click();
  await panel.getByRole('tab', { name: /^Data Trace/ }).click();
  return panel;
}

/** Trace on or off for the spec's lesson, from its Trace tab; the panel is closed afterwards. */
async function setTrace(page, on) {
  await page.goto(LESSON);
  await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
  const panel = await openTraceTab(page);
  const toggle = panel.getByRole('button', { name: /^(Start|Stop) trace$/ });
  if ((await toggle.textContent()) === (on ? 'Start trace' : 'Stop trace')) {
    const saved = savedPrefs(page);
    await toggle.click();
    await saved;
  }
  await expect(toggle).toHaveText(on ? 'Stop trace' : 'Start trace');
  await panel.getByRole('button', { name: /^Close( lesson panel)?$/ }).first().click();
  // Focus goes back to what opened the panel a frame later; wait, or the next keystrokes land there.
  await expect(page.getByRole('button', { name: /: lesson panel$/ })).toBeFocused();
  await expect(page.getByRole('button', { name: MARKER })).toHaveCount(on ? 1 : 0);
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

  test('off by default; started from the Trace tab: recorded and readable by keyboard', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, false);
    // No Trace control in the header while it's off.
    await expect(page.getByRole('button', { name: /Trace/ })).toHaveCount(0);

    // The Overview button opens the panel; its Trace tab has the way to start.
    const progress = page.getByRole('button', { name: /: lesson panel$/ });
    await progress.focus();
    await page.keyboard.press('Enter');
    const panel = panelOf(page);
    await expect(panel.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('tab', { name: 'Data Trace' }).click();
    await expect(panel.getByText('Not recording')).toBeVisible();
    await expectAccessible(page, { include: '#lesson-panel', label: 'trace tab, not recording' });
    const saved = savedPrefs(page);
    await panel.getByRole('button', { name: 'Start trace' }).click();
    await saved;
    await expect(panel.getByText('Recording', { exact: true }).first()).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Data Trace (recording)' })).toBeVisible();
    await expect(page.getByRole('button', { name: MARKER })).toBeVisible();
    await expectAccessible(page, { include: '#lesson-panel', label: 'trace tab, recording' });
    // Closing the panel keeps recording.
    await panel.getByRole('button', { name: 'Close lesson panel' }).click();
    await expect(page.getByRole('button', { name: MARKER })).toBeVisible();

    // Another lesson isn't recorded.
    await page.goto(`/lessons/${LESSONS[0].id}`);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: MARKER })).toHaveCount(0);

    // Start the lesson again so its trace is complete.
    await page.goto(LESSON);
    await expect(page.getByText(/Welcome! In this lesson/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Reset lesson' }).first().click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: /reset/i }).click();
    await page.waitForURL(/\/lessons$/);
    await page.goto(LESSON);
    await expect(page.getByText(/Welcome! In this lesson/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-chat-message="assistant"]')).toHaveCount(1);

    // The header's marker opens the Trace tab.
    const marker = page.getByRole('button', { name: MARKER });
    await marker.focus();
    await page.keyboard.press('Enter');

    // Docked beside the chat: a landmark, not a dialog, and the chat still works.
    await expect(page.getByRole('complementary', { name: LESSONS[1].name })).toBeVisible();
    await expect(panel.getByRole('tab', { name: /^Data Trace/ })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('heading', { name: LESSONS[1].name })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The list of exchanges: one per message, with what changed.
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toBeVisible();

    await say(page, 'My first answer about the key idea.');
    await expect(page.getByText(/Can you give a specific example/).first()).toBeVisible({ timeout: 20_000 });
    const row = panel.getByRole('button', { name: /^2\. Your message: “My first answer/ });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/Progress \d+ → \d+ of 10 · The model’s own answer/);

    // One exchange: what was sent and seen and who decided; every step is folded away.
    await row.focus();
    await page.keyboard.press('Enter');
    const exchange = panel.getByRole('article');
    await expect(exchange.getByRole('heading', { name: /^Exchange 2 of 2/ })).toBeFocused();
    await expect(exchange.getByRole('blockquote').filter({ hasText: 'My first answer about the key idea.' })).toBeVisible();
    await expect(exchange.getByText(/plato’s code changed nothing/)).toBeVisible();
    await expect(exchange.getByRole('heading', { name: 'Where plato stepped in' })).toHaveCount(0);
    await expect(exchange.getByRole('heading', { name: 'You sent' })).toBeHidden();
    // ⓘ: what the labels mean, closed until asked.
    const labels = exchange.getByRole('button', { name: 'What do these labels mean?' });
    await expect(labels).toHaveAttribute('aria-expanded', 'false');
    await labels.click();
    await expect(exchange.getByText(/^plato’s code:/).first()).toBeVisible();
    await expectAccessible(page, { include: '#lesson-panel', label: 'trace exchange, an explanation open' });
    await labels.click();
    // Every step, by stage; a step opens to what it did.
    await exchange.locator('summary', { hasText: /^Every step \(\d+\)$/ }).click();
    for (const stage of ['You sent', 'plato prepared and sent the request', 'The AI model answered', 'plato checked the answer', 'plato recorded the result']) {
      await expect(exchange.getByRole('heading', { name: stage })).toBeVisible();
    }
    // No lesson step on a later turn: it's shown once, at the start.
    await expect(exchange.locator('summary', { hasText: /^The lesson/ })).toHaveCount(0);
    // A call is the request (with its size) and the reply (size, time, why it stopped).
    const stepItem = (title) => exchange.locator('li[id*="-step-"]').filter({ has: page.locator('summary', { hasText: title }) });
    const request = stepItem(/^Sent to the Coach: reply/).first();
    await request.locator('summary').first().click();
    await expect(request.getByText(/^plato sent a stand-in model used for testing the Coach’s instructions \([\d,]+ characters/)).toBeVisible();
    // Who the agent is, from the header its call recorded.
    await request.getByRole('button', { name: 'Who is the Coach?' }).click();
    await expect(request.getByText(/^Talks with the learner/)).toBeVisible();
    await expect(request.getByText(/plato doesn’t send this description to the model/)).toBeVisible();
    await request.getByText(/^Show the exact text/).click();
    await request.getByText(/^Instructions, part 1 of \d+: The agent’s instructions/).first().click();
    await expect(request.locator('details[open] > pre').filter({ hasText: /^You are the Coach for plato/ }).first()).toBeVisible();
    await expect(request.locator('details[open] > pre').filter({ hasText: 'AGENT:' })).toHaveCount(0);
    const reply = stepItem(/^The Coach replied/).first();
    await reply.locator('summary').first().click();
    await expect(reply.getByText(/^[\d,]+ characters, after [\d.]+ m?s\. It stopped because it had finished\.$/)).toBeVisible();
    await reply.getByText(/^Show the exact text/).click();
    await reply.getByText('The model’s raw reply').click();
    await expect(reply.locator('details[open] > pre').filter({ hasText: /\[PROGRESS: \d+\]/ }).first()).toBeVisible();
    await expectAccessible(page, { label: 'lesson chat with the trace docked and an exchange open' });

    // Nothing in the panel is wider than the panel.
    const widths = await panel.getByRole('tabpanel', { name: /^Data Trace/ }).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1]);

    // Previous, and back to the list, by keyboard.
    await exchange.getByRole('button', { name: 'Previous exchange' }).click();
    await expect(exchange.getByRole('heading', { name: /^Lesson start/ })).toBeFocused();
    await exchange.locator('summary', { hasText: /^Every step/ }).click();
    await expect(exchange.getByRole('heading', { name: 'plato set up the lesson' })).toBeVisible();
    await exchange.getByRole('button', { name: 'All exchanges' }).click();
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toBeFocused();

    // The pinned header and composer leave room for the panel.
    const panelBox = await panel.boundingBox();
    const composerBox = await page.getByRole('textbox', { name: 'Your message' }).last().boundingBox();
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(panelBox.x + 1);

    // Escape closes it from inside and focus returns to the button.
    await panel.getByRole('tabpanel', { name: /^Data Trace/ }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(marker).toBeFocused();
  });

  test('a held completion is explained: flagged, who decided, before and after', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, true);
    const replies = page.locator('[data-chat-message="assistant"]');
    const before = await replies.count();
    await say(page, 'MOCK_COMPLETE MOCK_UNBACKED I think I am done');
    await expect(replies).toHaveCount(before + 1, { timeout: 30_000 });

    // From the reply: "Behind this response" opens the trace at that turn.
    const behind = page.getByRole('button', { name: /^Behind this response/ }).last();
    await behind.click();
    await page.getByRole('button', { name: 'Open the trace for this reply' }).last().click();
    const panel = panelOf(page);
    const exchange = panel.getByRole('article');
    await expect(exchange.getByRole('heading', { name: /^Exchange \d+ of \d+/ })).toBeFocused();
    await expect(exchange.getByRole('blockquote').filter({ hasText: 'MOCK_COMPLETE MOCK_UNBACKED I think I am done' })).toBeVisible();
    // Where plato stepped in, listed up front; each points at its step.
    const steppedIn = exchange.getByRole('region', { name: 'Where plato stepped in' }).or(exchange.locator('section', { has: page.getByRole('heading', { name: 'Where plato stepped in' }) }));
    await expect(steppedIn.getByText(/plato held the lesson open/)).toBeVisible();
    await expect(exchange.getByText(/plato’s code changed the result/)).toBeVisible();
    await expect(exchange.getByText('A different reply appeared first, then plato replaced it')).toBeVisible();
    await steppedIn.getByRole('listitem').filter({ hasText: /held the lesson open/ }).getByRole('button', { name: 'Show this step' }).click();
    await expect(exchange.locator('summary:focus')).toContainText('What the check changed');
    // Every check plato runs, as a question with its answer, even those that found nothing.
    await expect(exchange.getByRole('heading', { name: 'plato checked the answer' })).toBeVisible();
    await expect(exchange.locator('summary', { hasText: /^Did the reply include its tags\? Yes: the reply had the progress score and the notes/ })).toBeVisible();
    await expect(exchange.locator('summary', { hasText: /^Did the reply write your answer for you\?/ })).toBeVisible();
    await expect(exchange.locator('summary', { hasText: /^Is every objective the coach checked off shown in your own words\?/ })).toBeVisible();
    await expect(exchange.getByText('The Assessor’s verdict')).toBeVisible();
    await expectAccessible(page, { include: '#lesson-panel', label: 'trace with a held completion open' });

    // Across the conversation: what plato did, each line narrowing the list.
    await exchange.getByRole('button', { name: 'All exchanges' }).click();
    const held = panel.getByRole('button', { name: /^held a completion once$/ });
    await expect(panel.getByRole('heading', { name: /^Across \d+ exchanges, plato…$/ })).toBeVisible();
    await held.click();
    await expect(held).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('heading', { name: /^Exchanges \(1 of \d+\)$/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toHaveCount(0);
    await expectAccessible(page, { include: '#lesson-panel', label: 'trace list narrowed' });
    await panel.getByRole('button', { name: 'Show all' }).click();
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toBeVisible();
  });

  test('narrow screens get the trace as a dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page, LEARNER);
    await setTrace(page, true);
    await page.getByRole('button', { name: MARKER }).click();
    const dialog = page.getByRole('dialog', { name: LESSONS[1].name });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /^Exchanges/ })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expectAccessible(page, { include: '[role=dialog]', label: 'trace dialog (narrow)' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('admins have no Trace: not in View as User, not in the editors', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/plato/lessons/new');
    await expect(page.getByRole('button', { name: /^Behind this response/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Trace/ })).toHaveCount(0);
    await page.goto('/lessons');
    await page.getByRole('button', { name: 'View as user' }).click();
    await page.getByRole('textbox', { name: 'Search users' }).fill('Lee');
    await page.getByRole('button', { name: /^View as Lee Learner/ }).click();
    await expect(page.getByText('Viewing as').first()).toBeVisible({ timeout: 20_000 });
    await page.goto(LESSON);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /: lesson panel$/ }).click();
    await expect(panelOf(page).getByRole('tab', { name: /Trace/ })).toHaveCount(0);
    await expect(panelOf(page).getByRole('list', { name: 'Objectives' })).toBeVisible();
    await page.getByRole('button', { name: /^Exit viewing as/ }).click();
  });

  test('Technology and services, and downloading the trace', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, true);
    const panel = await openTraceTab(page);
    await expect(panel.getByRole('heading', { name: /^Exchanges/ })).toBeVisible();

    // Download, by keyboard (enabled once the trace has loaded).
    await expect(panel.getByRole('button', { name: 'Download as text' })).toBeEnabled();
    const [text] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download as text' }).press('Enter')]);
    expect(text.suggestedFilename()).toBe(`plato-trace-${LESSONS[1].id}.txt`);
    const [json] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download the data (JSON)' }).click()]);
    expect(json.suggestedFilename()).toBe(`plato-trace-${LESSONS[1].id}.json`);

    // Technology and services, a section that opens by keyboard.
    const tech = panel.locator('summary', { hasText: 'Technology and services' });
    await tech.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading', { name: 'Used by this classroom' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Amazon Bedrock' })).toBeVisible();
    await expect(panel.getByText('This install is using a stand-in model for testing, not a real AI model.')).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Not turned on here' })).toBeVisible();
    await expectAccessible(page, { include: '#lesson-panel', label: 'trace technology section' });
  });

  test('Settings: a learner adds profile feedback and reads its trace in a dialog, by keyboard', async ({ page }) => {
    await login(page, LEARNER);
    await page.goto('/settings');
    // Settings has no account-wide switch: the profile's Trace has its own.
    await expect(page.getByRole('heading', { name: 'Trace mode' })).toHaveCount(0);
    // The profile's Trace: start it there; closing the dialog keeps it going.
    const button = page.getByRole('button', { name: /^Data Trace for your notes/ });
    await button.click();
    const saved = savedPrefs(page);
    await page.getByRole('dialog', { name: 'Data Trace' }).getByRole('button', { name: 'Start trace' }).click();
    await saved;
    await page.getByRole('dialog', { name: 'Data Trace' }).getByRole('button', { name: 'Close' }).click();
    await expect(button).toHaveAccessibleName('Data Trace for your notes (recording)');
    await page.getByRole('button', { name: 'Add Feedback' }).click();
    const feedback = page.getByRole('dialog', { name: 'Add Profile Feedback' });
    await feedback.getByRole('textbox', { name: 'Profile feedback' }).fill('I use a Chromebook at the library.');
    await feedback.getByRole('button', { name: 'Submit' }).click();
    await expect(feedback).toHaveCount(0, { timeout: 20_000 });

    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Data Trace' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Data Trace', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: /^\d+\. You added a note: “I use a Chromebook at the library\.”/ }).click({ timeout: 20_000 });
    const turn = dialog.getByRole('article');
    await expect(turn.getByRole('heading', { name: /^Exchange \d+ of \d+/ })).toBeFocused();
    await turn.locator('summary', { hasText: /^Every step/ }).click();
    await expect(turn.locator('summary', { hasText: /^What you did/ })).toBeVisible();
    const call = turn.locator('li[id*="-step-"]').filter({ has: page.locator('summary', { hasText: /^Sent to the Learner Profile Update: profile update \(learner\)/ }) }).first();
    await call.locator('summary').first().click();
    await call.getByRole('button', { name: 'Who is the Learner Profile Update?' }).click();
    await expect(call.getByText(/^Keeps the learner’s profile up to date/)).toBeVisible();
    await expect(turn.locator('summary', { hasText: /^The learner profile was updated/ })).toBeVisible();
    await expectAccessible(page, { include: '[role=dialog]', label: 'settings: profile trace dialog' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    // Remove the note again so other specs see the profile as they left it.
    await page.getByRole('button', { name: 'Remove note: I use a Chromebook at the library.' }).click();
    await expect(page.getByRole('list', { name: 'Your notes' })).toHaveCount(0);
    // Stop trace ends it.
    await button.click();
    const stopped = savedPrefs(page);
    await page.getByRole('dialog', { name: 'Data Trace' }).getByRole('button', { name: 'Stop trace' }).click();
    await stopped;
    await page.keyboard.press('Escape');
    await expect(button).toHaveAccessibleName('Data Trace for your notes');
  });
});
