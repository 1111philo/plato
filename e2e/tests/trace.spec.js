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
    // The list of exchanges: one per message, with what changed.
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toBeVisible();

    await say(page, 'My first answer about the key idea.');
    await expect(page.getByText(/Can you give a specific example/).first()).toBeVisible({ timeout: 20_000 });
    const row = panel.getByRole('button', { name: /^2\. Your message: “My first answer/ });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/Progress \d+ → \d+ of 10 · The model’s own answer/);

    // One exchange: what was sent and seen, then what happened, in stages.
    await row.focus();
    await page.keyboard.press('Enter');
    const exchange = panel.getByRole('article');
    await expect(exchange.getByRole('heading', { name: /^Exchange 2 of 2/ })).toBeFocused();
    await expect(exchange.getByRole('blockquote').filter({ hasText: 'My first answer about the key idea.' })).toBeVisible();
    await expect(exchange.getByText(/plato’s code changed nothing/)).toBeVisible();
    for (const stage of ['1. You sent', '2. plato prepared and sent the request', '3. The AI model answered', '5. plato recorded the result', '6. In the background']) {
      await expect(exchange.getByRole('heading', { name: stage })).toBeVisible();
    }
    // No lesson step on a later turn: it's shown once, at the start.
    await expect(exchange.getByText('The lesson', { exact: true })).toHaveCount(0);
    await exchange.getByRole('link', { name: '3. The AI model answered' }).click();
    await expect(exchange.getByRole('heading', { name: '3. The AI model answered' })).toBeFocused();
    // A call is the request (with its size) and the reply (size, time, why it stopped).
    await expect(exchange.getByText('Sent to the AI model, for the coach: reply')).toBeVisible();
    await expect(exchange.getByText(/^plato sent a stand-in model used for testing the coach’s instructions \([\d,]+ characters/)).toBeVisible();
    await expect(exchange.getByText(/^[\d,]+ characters, after [\d.]+ m?s\. It stopped because it had finished\.$/).first()).toBeVisible();
    await expect(exchange.getByText(/^at [\d.]+ m?s · took [\d.]+ m?s$/).first()).toBeVisible();
    // The exact text, one disclosure per step.
    const reply = exchange.getByRole('listitem').filter({ has: page.getByText('The AI model replied to the coach', { exact: true }) }).last();
    await reply.getByText(/^Show the exact text/).click();
    await reply.getByText('The model’s raw reply').click();
    await expect(reply.locator('details[open] > pre').filter({ hasText: /\[PROGRESS: \d+\]/ }).first()).toBeVisible();
    const request = exchange.getByRole('listitem').filter({ has: page.getByText('Sent to the AI model, for the coach: reply', { exact: true }) }).last();
    await request.getByText(/^Show the exact text/).click();
    await request.getByText(/^Instructions: The agent’s instructions/).first().click();
    await expect(request.locator('details[open] > pre').filter({ hasText: 'AGENT: Coach' }).first()).toBeVisible();
    await expectAccessible(page, { label: 'lesson chat with the trace docked and an exchange open' });

    // Nothing in the panel is wider than the panel.
    const widths = await panel.getByRole('region', { name: 'Trace steps' }).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1]);

    // Previous, and back to the list, by keyboard.
    await exchange.getByRole('button', { name: 'Previous exchange' }).click();
    await expect(exchange.getByRole('heading', { name: /^Lesson start/ })).toBeFocused();
    await expect(exchange.getByRole('heading', { name: '1. plato set up the lesson' })).toBeVisible();
    await exchange.getByRole('button', { name: 'All exchanges' }).click();
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toBeFocused();

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
    const exchange = panel.getByRole('article');
    await expect(exchange.getByRole('heading', { name: /^Exchange \d+ of \d+/ })).toBeFocused();
    await expect(exchange.getByRole('blockquote').filter({ hasText: 'MOCK_COMPLETE MOCK_UNBACKED I think I am done' })).toBeVisible();
    // No separate list of what was unusual: it's said on the step where it happened.
    await expect(exchange.getByText('What was unusual')).toHaveCount(0);
    await expect(exchange.getByText(/^plato stepped in: plato held the lesson open/)).toBeVisible();
    await expect(exchange.getByText(/plato’s code changed the result/)).toBeVisible();
    await expect(exchange.getByText('A different reply appeared first, then plato replaced it')).toBeVisible();
    await expect(exchange.getByRole('heading', { name: '4. plato checked the answer' })).toBeVisible();
    // Every check plato runs, as a question with its answer, even those that found nothing.
    await expect(exchange.getByRole('heading', { name: '4.a Did the reply include its tags?' })).toBeVisible();
    await expect(exchange.getByRole('heading', { name: '4.b Did the reply write your answer for you?' })).toBeVisible();
    await expect(exchange.getByRole('heading', { name: '4.c Is every objective the coach checked off shown in your own words?' })).toBeVisible();
    await expect(exchange.getByText(/^Yes: the reply had the progress score and the notes/)).toBeVisible();
    await expect(exchange.getByText('The assessment check’s verdict')).toBeVisible();
    await expect(exchange.getByText(/^Rule:/).first()).toBeVisible();
    await expect(exchange.getByText('Before', { exact: true }).first()).toBeVisible();
    await expectAccessible(page, { include: '#lesson-trace', label: 'trace with a held completion open' });

    // The list can be narrowed to where plato stepped in or something went wrong.
    await exchange.getByRole('button', { name: 'All exchanges' }).click();
    const filter = panel.getByRole('checkbox', { name: /^Only where plato stepped in or something went wrong \(\d+\)$/ });
    await filter.check();
    const rows = panel.getByRole('list').last().getByRole('button');
    for (const r of await rows.all()) await expect(r).toContainText(/Changed by plato’s code|Shaped by plato’s instructions|Something went wrong/);
    await expect(panel.getByRole('button', { name: /^1\. Lesson start/ })).toHaveCount(0);
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
    await expect(dialog.getByRole('heading', { name: /^Exchanges/ })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expectAccessible(page, { include: '[role=dialog]', label: 'trace dialog (narrow)' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('View as User: an admin reads the learner’s trace, read-only', async ({ page }) => {
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
    await expect(panel.getByRole('button', { name: /^\d+\. Your message: “A turn for my teacher/ })).toBeVisible({ timeout: 20_000 });
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
    await expect(panel.getByRole('heading', { name: /^Exchanges/ })).toBeVisible();

    // Download, by keyboard (enabled once the trace has loaded).
    await expect(panel.getByRole('button', { name: 'Download as text' })).toBeEnabled();
    const [text] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download as text' }).press('Enter')]);
    expect(text.suggestedFilename()).toBe(`plato-trace-${LESSONS[1].id}.txt`);
    const [json] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download the data (JSON)' }).click()]);
    expect(json.suggestedFilename()).toBe(`plato-trace-${LESSONS[1].id}.json`);

    // The Technology tab: arrow keys move between tabs, Enter opens one.
    await panel.getByRole('tab', { name: 'What happened' }).focus();
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

  test('Settings: a learner adds profile feedback and reads its trace in a dialog, by keyboard', async ({ page }) => {
    await login(page, LEARNER);
    await setTrace(page, true);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Add Feedback' }).click();
    const feedback = page.getByRole('dialog', { name: 'Add Profile Feedback' });
    await feedback.getByRole('textbox', { name: 'Profile feedback' }).fill('I use a Chromebook at the library.');
    await feedback.getByRole('button', { name: 'Submit' }).click();
    await expect(feedback).toHaveCount(0, { timeout: 20_000 });

    const button = page.getByRole('button', { name: 'Trace: what plato did with your notes' });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Trace' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Trace', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: /^\d+\. You added a note: “I use a Chromebook at the library\.”/ }).click({ timeout: 20_000 });
    const turn = dialog.getByRole('article');
    await expect(turn.getByRole('heading', { name: /^Exchange \d+ of \d+/ })).toBeFocused();
    await expect(turn.getByText('What you did', { exact: true })).toBeVisible();
    await expect(turn.getByText('Sent to the AI model, for the learner profile: profile update (learner)')).toBeVisible();
    await expect(turn.getByText(/Who’s this\? Learner profile is one of plato’s AI helpers/)).toBeVisible();
    await expect(turn.getByText('The learner profile was updated')).toBeVisible();
    await expectAccessible(page, { include: '[role=dialog]', label: 'settings: profile trace dialog' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    // Remove the note again so other specs see the profile as they left it.
    await page.getByRole('button', { name: 'Remove note: I use a Chromebook at the library.' }).click();
    await expect(page.getByRole('list', { name: 'Your notes' })).toHaveCount(0);
  });

  test('lesson editor: an admin sends one message and reads its trace', async ({ page }) => {
    await login(page, ADMIN);
    await setTrace(page, true);
    await page.goto('/plato/lessons/new');
    await expect(page.getByRole('button', { name: /^Behind this response/ }).first()).toBeVisible({ timeout: 20_000 });
    const composer = page.getByRole('textbox', { name: 'Your message' }).last();
    await expect(composer).toBeEnabled({ timeout: 20_000 });
    await composer.fill('Learners write a clear bug report.');
    await composer.press(`${MOD}+Enter`);
    await expect(page.getByRole('button', { name: /^Behind this response/ })).toHaveCount(2, { timeout: 20_000 });

    const button = page.getByRole('button', { name: 'Trace: what plato did behind this conversation' });
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Trace' });
    await expect(dialog.getByRole('button', { name: /^1\. Conversation start/ })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: /^\d+\. Your message: “Learners write a clear bug report\.”/ }).click();
    const turn = dialog.getByRole('article');
    await expect(turn.getByText(/readiness score are the model’s own/)).toBeVisible();
    await expect(turn.getByText('What you wrote', { exact: true })).toBeVisible();
    await expect(turn.getByText('The AI model replied to the lesson creator')).toBeVisible();
    await expect(turn.getByText(/^Readiness score: \d+ of 10/)).toBeVisible();
    const parsed = turn.getByRole('listitem').filter({ has: page.getByText('What plato read from the reply', { exact: true }) }).last();
    await parsed.getByText(/^Show the exact text/).click();
    await turn.getByText('The reply with its score, as the model wrote it').click();
    await expect(turn.locator('details[open] > pre').filter({ hasText: /\[READINESS: \d+\]/ })).toBeVisible();
    await expectAccessible(page, { include: '[role=dialog]', label: 'lesson editor: trace dialog' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});
