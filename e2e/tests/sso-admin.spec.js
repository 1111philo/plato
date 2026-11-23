// Admin UX for single sign-on (docs/SSO.md, "For admins"): the Sign-in column
// and filter, Unlink on Edit User, the wait-list Verified mark, and the
// Microsoft Entra SSO plugin panel. SSO itself is off in this suite, so the
// server's answers are stubbed: a live provider, one linked account, one
// verified wait-list entry, and the plugin's status.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER, EDUCATOR } from '../fixtures.js';

const SSO_EMAIL = 'lee.learner@uic.edu';
const VERIFIED = { email: 'vera.verified@uic.edu', name: 'Vera Verified' };

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Loading...', { exact: true })).toHaveCount(0, { timeout: 15_000 });
}

// The Users page with SSO in play. Returns the stub's state: `linked` flips
// off when the (stubbed) unlink is called, and `deletes` records those calls.
async function stubSso(page) {
  const state = { linked: true, deletes: [] };
  await page.route('**/v1/auth/sso/providers', (route) => route.fulfill({ json: { providers: [{ id: 'entra', label: 'Sign in with UIC' }] } }));
  await page.route(/\/v1\/admin\/users\?include=stats$/, async (route) => {
    const res = await route.fetch();
    const users = await res.json();
    const learner = users.find((u) => u.email === LEARNER.email);
    if (state.linked) {
      learner.sso = { provider: 'entra', email: SSO_EMAIL, linkedAt: '2026-11-03T15:00:00.000Z' };
    }
    learner.hasPassword = false;
    await route.fulfill({ response: res, json: users });
  });
  await page.route('**/v1/admin/users/*/sso', async (route) => {
    state.deletes.push({ method: route.request().method(), url: route.request().url() });
    state.linked = false;
    await route.fulfill({ json: { ok: true, hasPassword: false } });
  });
  await page.route('**/v1/admin/waitlist', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.entries.push({
      inviteToken: 'wl-sso-e2e', email: VERIFIED.email, name: VERIFIED.name, firstName: 'Vera', lastName: 'Verified',
      alreadyRegistered: null, userGroup: null, customFields: {}, createdAt: '2026-11-10T12:00:00.000Z', ssoVerified: 'entra',
    });
    await route.fulfill({ response: res, json: body });
  });
  return state;
}

test('with SSO off, the Users page has no Sign-in column or filter', async ({ page }) => {
  // The e2e server has SSO on (global-setup.js, for sso.spec.js), so "off" is stubbed here.
  await page.route('**/v1/auth/sso/providers', (route) => route.fulfill({ json: { providers: [] } }));
  await login(page, ADMIN);
  await page.goto('/plato/users');
  const table = page.getByRole('table', { name: 'Users and invites' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Sign-in' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('group', { name: 'Status' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Sign-in' })).toHaveCount(0);
  await expect(menu.getByRole('menuitemcheckbox', { name: /verified/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Edit User has no Sign-in block either.
  await page.getByRole('button', { name: `Edit ${LEARNER.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sign-in' })).toHaveCount(0);
});

test('admins see how each account signs in, filter by it, and spot verified wait-list entries', async ({ page }) => {
  await stubSso(page);
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await settle(page);
  const table = page.getByRole('table', { name: 'Users and invites' });
  await expect(table.getByRole('columnheader', { name: 'Sign-in' })).toBeVisible();

  // Column: the provider's short name for an SSO-only account, Password for the rest.
  const cellOf = async (rowText) => {
    const headers = await table.getByRole('columnheader').allTextContents();
    const at = headers.findIndex((h) => h.trim() === 'Sign-in');
    return table.getByRole('row').filter({ hasText: rowText }).getByRole('cell').nth(at);
  };
  await expect(await cellOf(LEARNER.email)).toHaveText('UIC');
  await expect(await cellOf(EDUCATOR.email)).toHaveText('Password');

  // Wait list: the Verified mark names the provider for screen readers and on hover.
  const verifiedRow = table.getByRole('row').filter({ hasText: VERIFIED.email });
  await expect(verifiedRow).toContainText('Email verified by UIC sign-in');
  await expect(verifiedRow.getByTitle('Email verified by UIC sign-in')).toBeVisible();
  await expectAccessible(page, { label: 'users with SSO in play' });

  // Filter, by keyboard: Sign-in → SSO keeps only the linked account.
  await page.getByRole('button', { name: /^Filters/ }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('group', { name: 'Sign-in' })).toBeVisible();
  await expectAccessible(page, { include: '[role=menu]', label: 'filters menu with Sign-in' });
  await menu.getByRole('menuitemcheckbox', { name: /^SSO/ }).focus();
  await page.keyboard.press('Space');
  await expect(menu.getByRole('menuitemcheckbox', { name: /^SSO/ })).toBeChecked();
  await page.keyboard.press('Escape');
  const chips = page.getByRole('list', { name: 'Filters on' });
  await expect(chips).toContainText('Sign-in: SSO');
  await expect(table.getByRole('row').filter({ hasText: LEARNER.email })).toHaveCount(1);
  await expect(table.getByRole('row').filter({ hasText: EDUCATOR.email })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: VERIFIED.email })).toHaveCount(0);
  await chips.getByRole('button', { name: 'Clear all' }).click();

  // Status → Wait list: email verified.
  await page.getByRole('button', { name: /^Filters/ }).focus();
  await page.keyboard.press('Enter');
  await menu.getByRole('menuitemcheckbox', { name: /^Wait list: email verified/ }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect(chips).toContainText('Status: Wait list: email verified');
  await expect(table.getByRole('row').filter({ hasText: VERIFIED.email })).toHaveCount(1);
  await expect(table.getByRole('row').filter({ hasText: LEARNER.email })).toHaveCount(0);
});

test('admins unlink an account’s single sign-on from Edit User', async ({ page }) => {
  const state = await stubSso(page);
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await settle(page);
  await page.getByRole('button', { name: `Edit ${LEARNER.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();

  const block = page.getByRole('region', { name: 'Sign-in' });
  await expect(block).toContainText('No password');
  await expect(block).toContainText(`UIC: ${SSO_EMAIL}, connected`);
  await settle(page);
  await expectAccessible(page, { label: 'edit user with a linked identity' });

  // By keyboard: open the confirm dialog, cancel, reopen, confirm.
  const unlink = block.getByRole('button', { name: 'Unlink UIC sign-in' });
  await unlink.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: 'Unlink UIC sign-in?' });
  await expect(dialog).toContainText('They’ll sign in with their password. If they don’t have one, they’ll need Forgot password.');
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await expectAccessible(page, { include: '[role=alertdialog]', label: 'unlink SSO dialog' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(unlink).toBeFocused();
  expect(state.deletes).toHaveLength(0);

  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('alert').filter({ hasText: `Unlinked. ${LEARNER.email} has no password, so they’ll need Forgot password to sign in.` })).toBeVisible();
  expect(state.deletes).toHaveLength(1);
  expect(state.deletes[0].method).toBe('DELETE');
  expect(state.deletes[0].url).toMatch(/\/v1\/admin\/users\/[^/]+\/sso$/);

  // The row refreshed in place: still on Edit User, now unlinked.
  await expect(page.getByRole('heading', { name: 'Edit User' })).toBeVisible();
  await expect(block).toContainText('Single sign-on not connected');
  await expect(block.getByRole('button', { name: /Unlink/ })).toHaveCount(0);
  await expect(block.getByRole('heading', { name: 'Sign-in' })).toBeFocused();
  // Let the dialog finish closing: axe would sample it mid-fade.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expectAccessible(page, { label: 'edit user after unlink' });
});

// The Plugins page with the Entra plugin switched on and a stubbed status.
async function stubEntraPlugin(page, status, settings = {}) {
  const saves = [];
  const current = { ...settings };
  await page.route('**/v1/admin/plugins', async (route) => {
    const res = await route.fetch();
    const list = await res.json();
    const entra = list.find((p) => p.id === 'entra-sso');
    entra.enabled = true;
    entra.settings = { ...current };
    await route.fulfill({ response: res, json: list });
  });
  await page.route('**/v1/admin/plugins/entra-sso/settings', async (route) => {
    const body = route.request().postDataJSON();
    saves.push({ method: route.request().method(), body });
    Object.assign(current, body);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/v1/plugins/entra-sso/admin/status', (route) => route.fulfill({ json: status }));
  return saves;
}

test('the Entra plugin panel shows the deployment’s settings and saves the button label', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const redirectUri = 'https://learn.example.edu/v1/auth/sso/entra/callback';
  const saves = await stubEntraPlugin(page, {
    configured: true, tenantId: '1234…abcd', clientId: '9876…ef01', domains: ['uic.edu'], redirectUri,
  });
  await login(page, ADMIN);
  await page.goto('/plato/plugins');
  await settle(page);

  const status = page.getByRole('region', { name: 'Deployment settings' });
  await expect(status).toContainText('Configured');
  await expect(status).toContainText('1234…abcd');
  await expect(status).toContainText('9876…ef01');
  await expect(status).toContainText('uic.edu');
  await expect(status).toContainText('These come from the deployment and can’t be changed here.');
  const uri = status.getByRole('textbox', { name: 'Redirect URI' });
  await expect(uri).toHaveValue(redirectUri);
  await expect(uri).not.toBeEditable();
  // Nothing about trust is a form field: only the button's look is editable.
  await expect(page.getByLabel(/tenant|client id|secret|domain/i)).toHaveCount(0);

  await status.getByRole('button', { name: 'Copy redirect URI' }).focus();
  await page.keyboard.press('Enter');
  await expect(status.getByRole('status')).toHaveText('Redirect URI copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(redirectUri);

  await expect(page.getByRole('region', { name: 'How it works' })).toContainText('An existing account with a @uic.edu email is connected automatically.');

  // Button label: the preview follows the field; Enter saves.
  const label = page.getByLabel('Button label');
  await expect(label).toHaveAttribute('maxlength', '40');
  const preview = page.getByTestId('entra-button-preview');
  await expect(preview).toHaveText('Sign in with Microsoft');
  await label.fill('  Sign in with UIC ');
  await expect(preview).toHaveText('Sign in with UIC');
  await label.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0].method).toBe('PUT');
  expect(saves[0].body).toEqual({ buttonLabel: 'Sign in with UIC', buttonBackground: '', buttonTextColor: '', buttonIcon: '' });
  await expectAccessible(page, { label: 'plugins page with the Entra panel' });
});

test('the Entra plugin panel sets the button’s icon and colors, by keyboard, and refuses a low-contrast pair', async ({ page }) => {
  const saves = await stubEntraPlugin(page, {
    configured: true, tenantId: '1234…abcd', clientId: '9876…ef01', domains: ['uic.edu'], redirectUri: 'https://learn.example.edu/v1/auth/sso/entra/callback',
  }, { buttonLabel: 'Sign in with UIC' });
  await login(page, ADMIN);
  await page.goto('/plato/plugins');
  await settle(page);

  const form = page.getByRole('form', { name: 'Sign-in button' });
  const preview = page.getByTestId('entra-button-preview');
  const previewButton = preview.locator('button');
  const contrast = form.locator('#entra-button-colors-help');
  const bg = form.getByLabel('Background color', { exact: true });
  const fg = form.getByLabel('Text color', { exact: true });
  const save = form.getByRole('button', { name: 'Save' });

  // Nothing set: the site's own button, and nothing to remove or reset.
  await expect(contrast).toHaveText('Empty uses the site’s button style.');
  await expect(preview.locator('img')).toHaveCount(0);
  expect(await previewButton.getAttribute('style')).toBeNull();
  await expect(form.getByRole('button', { name: 'Remove icon' })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Reset colors' })).toHaveCount(0);
  // The preview is the real button, but not a tab stop here.
  await expect(preview).toHaveAttribute('inert', '');

  // One color alone can't be saved.
  await bg.focus();
  await page.keyboard.type('#001E62');
  await expect(contrast).toHaveText('Set both colors, or neither.');
  await expect(bg).toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Enter');
  await expect(form.getByRole('alert').filter({ hasText: 'Not saved. Set both colors, or neither.' })).toBeVisible();
  expect(saves).toHaveLength(0);

  // A low-contrast pair: the live ratio says so, the preview stays default, and Save refuses.
  await page.keyboard.press('Tab'); // the text color's picker
  await expect(form.getByLabel('Text color picker')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(fg).toBeFocused();
  await page.keyboard.type('#33448F');
  await expect(contrast).toHaveText(/^Contrast 1\.\d\d:1\. It needs at least 4\.5:1\.$/);
  expect(await previewButton.getAttribute('style')).toBeNull();
  await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: 'Reset colors' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(form.getByRole('alert').filter({ hasText: /Not saved\. Contrast 1\.\d\d:1\. It needs at least 4\.5:1\./ })).toBeVisible();
  expect(saves).toHaveLength(0);
  await expectAccessible(page, { label: 'Entra panel refusing a low-contrast pair' });

  // A pair that passes shows in the preview.
  await fg.fill('#FFFFFF');
  await expect(contrast).toHaveText('Contrast 15.41:1. Passes.');
  await expect(bg).not.toHaveAttribute('aria-invalid', 'true');
  await expect(previewButton).toHaveCSS('background-color', 'rgb(0, 30, 98)');
  await expect(previewButton).toHaveCSS('color', 'rgb(255, 255, 255)');

  // Icon: an SVG is refused; a PNG is redrawn small and shown in the preview.
  const file = form.getByLabel('Icon', { exact: true });
  await expect(file).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
  await file.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(form.getByRole('alert').filter({ hasText: 'Use a PNG, JPEG, or WebP image.' })).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(0);
  // 200 × 100, drawn in the page so the upload is a real PNG.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d50032'; ctx.fillRect(0, 0, 200, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  await file.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const icon = preview.locator('img');
  await expect(icon).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(icon).toHaveAttribute('alt', '');
  expect(await icon.evaluate((el) => [el.naturalWidth, el.naturalHeight, el.offsetWidth, el.offsetHeight])).toEqual([64, 32, 20, 20]);
  await expect(form.getByRole('alert').filter({ hasText: 'Use a PNG' })).toHaveCount(0);
  await expectAccessible(page, { label: 'Entra panel with an icon and colors' });

  await save.focus();
  await page.keyboard.press('Enter');
  await expect(form.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(saves).toHaveLength(1);
  const saved = saves[0].body;
  expect(saved).toMatchObject({ buttonLabel: 'Sign in with UIC', buttonBackground: '#001E62', buttonTextColor: '#FFFFFF' });
  expect(saved.buttonIcon).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  expect(saved.buttonIcon.length).toBeLessThanOrEqual(20480);

  // Remove icon and Reset colors, by keyboard; focus stays in the form.
  await form.getByRole('button', { name: 'Remove icon' }).focus();
  await page.keyboard.press('Enter');
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(file).toBeFocused();
  await form.getByRole('button', { name: 'Reset colors' }).focus();
  await page.keyboard.press('Enter');
  await expect(bg).toHaveValue('');
  await expect(fg).toHaveValue('');
  await expect(bg).toBeFocused();
  await expect(contrast).toHaveText('Empty uses the site’s button style.');
  expect((await previewButton.getAttribute('style')) || '').toBe('');
  await save.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1].body).toEqual({ buttonLabel: 'Sign in with UIC', buttonBackground: '', buttonTextColor: '', buttonIcon: '' });
});

test('the Entra plugin panel says when the deployment hasn’t configured it', async ({ page }) => {
  await stubEntraPlugin(page, {
    configured: false, tenantId: null, clientId: null, domains: [], redirectUri: 'http://localhost:3490/v1/auth/sso/entra/callback',
  }, { buttonLabel: 'Sign in with UIC' });
  await login(page, ADMIN);
  await page.goto('/plato/plugins');
  await settle(page);

  const status = page.getByRole('region', { name: 'Deployment settings' });
  await expect(status).toContainText('Not configured: this deployment hasn’t supplied its Entra settings');
  await expect(status.getByRole('link', { name: 'docs/SSO.md' })).toBeVisible();
  await expect(status.getByRole('textbox', { name: 'Redirect URI' })).toHaveValue(/\/v1\/auth\/sso\/entra\/callback$/);
  await expect(page.getByLabel('Button label')).toHaveValue('Sign in with UIC');
  await expectAccessible(page, { label: 'plugins page, Entra not configured' });
});
