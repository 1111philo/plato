// Trace mode, admin controls (#595): the Edit User checkbox, the Users filter
// and column, and the bulk On / Off, by keyboard.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, EDUCATOR, TESTER, LEARNER, LESSONS } from '../fixtures.js';

const apiFor = (page) => async (method, path, token, body) => {
  const res = await page.request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
  expect(res.ok(), `${method} ${path}`).toBe(true);
  return res.json();
};
const tokenOf = async (api, who) => (await api('POST', '/v1/auth/login', null, { email: who.email, password: who.password })).accessToken;
/** `{ [email]: traceMode }` for every account. */
const traceByEmail = async (api, admin) => Object.fromEntries((await api('GET', '/v1/admin/users', admin)).map((u) => [u.email, u.traceMode]));
/** Leave the seed as it was: Trace mode off for everyone. */
async function allOff(api, admin) {
  const users = await api('GET', '/v1/admin/users', admin);
  const on = users.filter((u) => u.traceMode).map((u) => u.userId);
  if (on.length) await api('POST', '/v1/admin/users/bulk-update', admin, { userIds: on, set: { field: 'traceMode', value: false } });
}

test('an admin turns Trace mode on for a person; the filter and the column find them', async ({ page }) => {
  const api = apiFor(page);
  const admin = await tokenOf(api, ADMIN);
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    await page.getByRole('button', { name: `Edit ${LEARNER.name}` }).click();
    await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();

    const box = page.getByRole('checkbox', { name: 'Trace mode' });
    await expect(box).not.toBeChecked();
    await expect(box).toHaveAccessibleDescription('Records every lesson and conversation of this person’s, not only the ones they turn on. They see it’s on, can’t turn it off, and can read the trace too.');
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await expectAccessible(page, { label: 'edit user, trace mode on' });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'User updated.' })).toBeVisible();

    // The learner's own app is told.
    expect((await api('GET', '/v1/me', await tokenOf(api, LEARNER))).traceMode).toBe(true);

    // The filter narrows the list to them.
    const table = page.getByRole('table', { name: 'Users and invites' });
    await page.getByRole('button', { name: /^Filters/ }).focus();
    await page.keyboard.press('Enter');
    const facet = page.getByRole('menu').getByRole('group', { name: 'Trace mode' });
    await expect(facet.getByRole('menuitemcheckbox', { name: /^On/ })).toContainText('1');
    await facet.getByRole('menuitemcheckbox', { name: /^On/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('list', { name: 'Filters on' })).toContainText('Trace mode: On');
    await expect(table.getByRole('row')).toHaveCount(2); // header + the learner
    await expect(table.getByRole('row').filter({ hasText: LEARNER.email })).toHaveCount(1);

    // The Trace column is hidden until chosen.
    await expect(table.getByRole('columnheader', { name: 'Trace' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('dialog', { name: 'Users table columns' }).getByRole('checkbox', { name: 'Trace' }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    const col = (await table.getByRole('columnheader').allInnerTexts()).findIndex((h) => h.trim() === 'Trace');
    expect(col).toBeGreaterThan(-1);
    const cellOf = (row) => row.getByRole('cell').nth(col);
    await expect(cellOf(table.getByRole('row').filter({ hasText: LEARNER.email }))).toHaveText('On');
    await page.getByRole('list', { name: 'Filters on' }).getByRole('button', { name: 'Clear all' }).click();
    await expect(cellOf(table.getByRole('row').filter({ hasText: EDUCATOR.email }))).toHaveText('—');
    await expectAccessible(page, { label: 'users with the Trace column' });

    // Re-opening Edit User shows it on; unchecking and saving turns it off.
    await page.getByRole('button', { name: `Edit ${LEARNER.name}` }).click();
    await expect(page.getByRole('checkbox', { name: 'Trace mode' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Trace mode' }).uncheck();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'User updated.' })).toBeVisible();
    expect((await traceByEmail(api, admin))[LEARNER.email]).toBe(false);
  } finally {
    await allOff(api, admin);
  }
});

test('turned on by an admin: every lesson records, and the learner can’t turn it off', async ({ page }) => {
  const api = apiFor(page);
  const admin = await tokenOf(api, ADMIN);
  try {
    const learner = (await api('GET', '/v1/admin/users', admin)).find((u) => u.email === LEARNER.email);
    await api('POST', '/v1/admin/users/bulk-update', admin, { userIds: [learner.userId], set: { field: 'traceMode', value: true } });
    await login(page, LEARNER);
    await page.goto(`/lessons/${LESSONS[0].id}`);
    await expect(page.locator('[data-chat-message="assistant"]').first()).toBeVisible({ timeout: 20_000 });
    const button = page.getByRole('button', { name: 'Trace: what plato did behind this conversation (recording)' });
    await button.click();
    const box = page.getByRole('checkbox', { name: 'Record this lesson' });
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
    await expect(box).toHaveAccessibleDescription(/^Turned on by your classroom team, for everything you do\./);
    await expectAccessible(page, { include: '#lesson-trace', label: 'trace turned on by the team' });
  } finally {
    await allOff(api, admin);
  }
});

test('an educator sees Trace mode on Edit User but can’t change it', async ({ page }) => {
  await login(page, EDUCATOR);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: `Edit ${LEARNER.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Trace mode' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

test('admins turn Trace mode on and off for the users they select', async ({ page }) => {
  const api = apiFor(page);
  const admin = await tokenOf(api, ADMIN);
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    const table = page.getByRole('table', { name: 'Users and invites' });
    const bar = page.getByRole('region', { name: 'Selected users' });
    const select = async (people) => {
      for (const u of people) {
        await table.getByRole('checkbox', { name: `Select ${u.name}` }).focus();
        await page.keyboard.press('Space');
      }
      await bar.getByRole('button', { name: 'Update…' }).click();
    };

    // On for two.
    await select([EDUCATOR, TESTER]);
    const dialog = page.getByRole('dialog', { name: 'Update 2 users' });
    await dialog.getByLabel('What to change').selectOption({ label: 'Trace mode' });
    const group = dialog.getByRole('group', { name: 'Trace mode' });
    await expect(group.getByRole('radio', { name: 'On' })).toBeChecked();
    await expect(dialog).toContainText('Records every lesson and conversation of 2 users, not only the ones they turn on. They see it’s on, can’t turn it off, and can read the trace too.');
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectAccessible(page, { include: '[role=dialog]', label: 'bulk update dialog, trace mode' });
    await dialog.getByRole('button', { name: 'Turn on for 2 users' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Trace mode turned on for 2 people.' })).toBeVisible();
    await expect(bar).toHaveCount(0); // selection cleared
    let trace = await traceByEmail(api, admin);
    expect([trace[EDUCATOR.email], trace[TESTER.email], trace[LEARNER.email]]).toEqual([true, true, false]);

    // On for three: two already had it.
    await select([EDUCATOR, TESTER, LEARNER]);
    const three = page.getByRole('dialog', { name: 'Update 3 users' });
    await three.getByLabel('What to change').selectOption({ label: 'Trace mode' });
    await three.getByRole('button', { name: 'Turn on for 3 users' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Trace mode turned on for 1 person. 2 already had it on.' })).toBeVisible();

    // Off for all three, choosing Off with the arrow keys.
    await select([EDUCATOR, TESTER, LEARNER]);
    await three.getByLabel('What to change').selectOption({ label: 'Trace mode' });
    await three.getByRole('radio', { name: 'On' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(three.getByRole('radio', { name: 'Off' })).toBeChecked();
    await expect(three).toContainText('Turns Trace mode off for 3 users. Lessons they turned on themselves keep recording.');
    await three.getByRole('button', { name: 'Turn off for 3 users' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Trace mode turned off for 3 people.' })).toBeVisible();
    trace = await traceByEmail(api, admin);
    expect([trace[EDUCATOR.email], trace[TESTER.email], trace[LEARNER.email]]).toEqual([false, false, false]);
  } finally {
    await allOff(api, admin);
  }
});

test('Trace mode isn’t offered for wait-list entries, and skips them in a mixed selection', async ({ page }) => {
  const api = apiFor(page);
  const admin = await tokenOf(api, ADMIN);
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: true });
  await api('POST', '/v1/waitlist', null, { name: 'Tracy Waiting', email: 'tracy-waiting@example.com' });
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: false });
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    const table = page.getByRole('table', { name: 'Users and invites' });
    const bar = page.getByRole('region', { name: 'Selected users' });
    await table.getByRole('checkbox', { name: 'Select Tracy Waiting' }).check();
    await bar.getByRole('button', { name: 'Update…' }).click();
    const one = page.getByRole('dialog', { name: 'Update 1 user' });
    await expect(one.getByLabel('What to change').getByRole('option', { name: 'Trace mode' })).toHaveCount(0);
    await one.getByRole('button', { name: 'Cancel' }).click();

    await table.getByRole('checkbox', { name: `Select ${TESTER.name}` }).check();
    await bar.getByRole('button', { name: 'Update…' }).click();
    const two = page.getByRole('dialog', { name: 'Update 2 users' });
    await two.getByLabel('What to change').selectOption({ label: 'Trace mode' });
    await expect(two).toContainText('Wait-list entries are skipped.');
    await two.getByRole('button', { name: 'Turn on for 1 user' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Trace mode turned on for 1 person.' });
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText('already'); // the entry wasn't sent, so it isn't counted
    expect((await traceByEmail(api, admin))[TESTER.email]).toBe(true);
  } finally {
    await allOff(api, admin);
    const { entries } = await api('GET', '/v1/admin/waitlist', admin);
    for (const e of entries.filter((x) => x.email === 'tracy-waiting@example.com')) await api('DELETE', `/v1/admin/waitlist/${e.inviteToken}`, admin);
  }
});
