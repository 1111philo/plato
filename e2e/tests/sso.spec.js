// Single sign-on, end to end (docs/SSO.md): the real routes and account
// rules against a stand-in identity provider (fake-idp-server.js) that signs
// real tokens and enforces PKCE. Each test says who "signs in" at the
// provider, then drives the app with the keyboard.
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN } from '../fixtures.js';
import { BASE_URL, DB_PATH, IDP_URL, SSO_DOMAIN } from '../playwright.config.js';

const BUTTON = 'Sign in with UIC';
// Has a password account whose email the provider vouches for.
const MATCH = { email: `morgan@${SSO_DOMAIN}`, password: 'password123', name: 'Morgan Match' };

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json().catch(() => null);
}

const person = (first, last, email = `${first.toLowerCase()}@${SSO_DOMAIN}`) => ({
  sub: `sub-${first.toLowerCase()}`, oid: `oid-${first.toLowerCase()}`, email, preferred_username: email, given_name: first, family_name: last, name: `${first} ${last}`,
});

/** Who the provider signs in on the next authorize request (used once). */
async function providerWillSignIn(claims) {
  const res = await fetch(`${IDP_URL}/__control/next`, { method: 'POST', body: JSON.stringify(claims ? { claims } : { cancel: true }) });
  if (!res.ok) throw new Error(`fake identity provider → ${res.status}`);
}

async function press(page, locator) {
  await locator.focus();
  await page.keyboard.press('Enter');
}

/** The signed-in browser's own account, from /v1/me. */
const me = (page) => page.evaluate(async () => {
  const { accessToken } = JSON.parse(localStorage.getItem('plato_auth'));
  return (await fetch('/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } })).json();
});

async function removeUser(admin, email) {
  const users = await api('GET', '/v1/admin/users', admin);
  const user = users.find((u) => u.email === email);
  if (user) await api('DELETE', `/v1/admin/users/${user.userId}`, admin);
}

let admin;

test.beforeAll(async () => {
  ({ accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password }));
  execFileSync(process.execPath, ['scripts/create-dev-user.js', MATCH.email, MATCH.password, MATCH.name], {
    cwd: new URL('../../server/', import.meta.url),
    env: { ...process.env, DB_BACKEND: 'sqlite', SQLITE_PATH: DB_PATH },
    stdio: 'ignore',
  });
});

test.afterAll(async () => {
  await removeUser(admin, MATCH.email);
});

test('no account: the invite-only screen, then the wait list with the verified email', async ({ page }) => {
  const nova = person('Nova', 'Newcomer');
  try {
    // Wait list closed: nothing to join.
    await providerWillSignIn(nova);
    await page.goto('/login');
    await press(page, page.getByRole('button', { name: BUTTON }));
    const heading = page.getByRole('heading', { name: 'You don’t have an account yet' });
    await expect(heading).toBeFocused();
    await expect(page).toHaveURL(/\/sso\/complete$/); // the one-time code is gone from the address bar
    await expect(page.getByText('Ask your program team for an invite.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join the wait list' })).toHaveCount(0);
    await expectAccessible(page, { label: 'sso: no account, wait list closed' });
    await press(page, page.getByRole('button', { name: 'Back to sign in' }));
    await expect(page).toHaveURL(/\/login$/);

    // Wait list open: join it with the name and email the provider gave.
    await api('PUT', '/v1/admin/waitlist/settings', admin, { open: true });
    await providerWillSignIn(nova);
    await press(page, page.getByRole('button', { name: BUTTON }));
    await expect(heading).toBeFocused();
    await expect(page.getByText(nova.email)).toBeVisible();
    await expectAccessible(page, { label: 'sso: no account, wait list open' });
    await press(page, page.getByRole('button', { name: 'Join the wait list' }));

    await expect(page).toHaveURL(/\/waitlist$/); // no ticket in the URL
    const email = page.getByLabel('Email', { exact: true });
    await expect(email).toHaveValue(nova.email);
    await expect(email).toHaveAttribute('readonly', '');
    await expect(page.getByLabel(/first name/i)).toHaveValue('Nova');
    await expect(page.getByLabel(/last name/i)).toHaveValue('Newcomer');
    await expectAccessible(page, { label: 'wait list after sso' });
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('ticket');
    await press(page, page.getByRole('button', { name: 'Join the wait list' }));
    await expect(page.getByRole('status').filter({ hasText: 'You are on the wait list' })).toBeVisible();

    const { entries } = await api('GET', '/v1/admin/waitlist', admin);
    const entry = entries.find((e) => e.email === nova.email);
    expect(entry).toBeTruthy();
    expect(entry.ssoVerified).toBe('entra');

    // Signing in again while waiting says so, and offers nothing to join.
    await providerWillSignIn(nova);
    await page.goto('/login');
    await press(page, page.getByRole('button', { name: BUTTON }));
    await expect(page.getByRole('heading', { name: 'You’re on the wait list' })).toBeFocused();
    await expect(page.getByText('We’ll email you when you’re invited.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join the wait list' })).toHaveCount(0);
    await expectAccessible(page, { label: 'sso: on the wait list' });
  } finally {
    const { entries } = await api('GET', '/v1/admin/waitlist', admin);
    for (const e of entries.filter((x) => x.email === nova.email)) await api('DELETE', `/v1/admin/waitlist/${e.inviteToken}`, admin);
    await api('PUT', '/v1/admin/waitlist/settings', admin, { open: false });
  }
});

test('an invited address is signed in to a new account, with no password asked', async ({ page }) => {
  const ivy = person('Ivy', 'Invited');
  await api('POST', '/v1/admin/invites', admin, { email: ivy.email });
  try {
    await providerWillSignIn(ivy);
    await page.goto('/login');
    await press(page, page.getByRole('button', { name: BUTTON }));
    await expect(page).toHaveURL(/\/lessons$/);
    await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Your username is' })).toBeVisible();
    const account = await me(page);
    expect(account.email).toBe(ivy.email);
    expect(account.signIn).toEqual({ password: false, sso: { provider: 'entra', email: ivy.email } });

    // Settings: no password to change, and the only way in can't be disconnected.
    await page.goto('/settings');
    await expect(page.getByText(`Connected as ${ivy.email}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Not set', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Current Password', { exact: true })).toHaveCount(0);
    await expectAccessible(page, { label: 'settings: sso account without a password' });
    await press(page, page.getByRole('button', { name: 'Disconnect UIC' }));
    await expect(page.getByRole('alert').filter({ hasText: 'Set a password first, so you can still sign in.' })).toBeVisible();
    expect((await me(page)).signIn.sso).toBeTruthy();

    // Adding a password: the link is emailed, and it opens while signed in.
    await press(page, page.getByRole('button', { name: 'Email me a link to set one' }));
    await expect(page.getByRole('status').filter({ hasText: `We sent a link to ${ivy.email}.` })).toBeVisible();
    await page.goto('/reset-password?reset=not-a-real-token');
    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  } finally {
    await removeUser(admin, ivy.email);
  }
});

test('a password account with a matching address is signed in to that account', async ({ page }) => {
  const users = await api('GET', '/v1/admin/users', admin);
  const { userId } = users.find((u) => u.email === MATCH.email);
  try {
    await providerWillSignIn(person('Morgan', 'Match', MATCH.email));
    await page.goto('/login');
    await press(page, page.getByRole('button', { name: BUTTON }));
    await expect(page).toHaveURL(/\/lessons$/);
    await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible({ timeout: 20_000 });
    const account = await me(page);
    expect(account.userId).toBe(userId);
    expect(account.signIn).toEqual({ password: true, sso: { provider: 'entra', email: MATCH.email } });
  } finally {
    await api('DELETE', `/v1/admin/users/${userId}/sso`, admin); // the next test starts unconnected
  }
});

test('a cancelled or failed sign-in says so on the login page', async ({ page }) => {
  await providerWillSignIn(null);
  await page.goto('/login');
  await press(page, page.getByRole('button', { name: BUTTON }));
  await expect(page.getByRole('alert')).toHaveText('Sign-in was cancelled.');
  await expect(page).toHaveURL(/\/login$/); // ?sso= is removed once shown
  await expectAccessible(page, { label: 'login: sso cancelled' });
  // The password form still works from here.
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

  await page.goto('/login?sso=failed');
  await expect(page.getByRole('alert')).toHaveText('We couldn’t sign you in with UIC. Try again, or use your email and password.');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/login?sso=unavailable');
  await expect(page.getByRole('alert')).toHaveText('Signing in with UIC isn’t available right now.');
  await page.goto('/login?sso=expired');
  await expect(page.getByRole('alert')).toHaveText('That sign-in took too long. Please try again.');
  await page.goto('/login?sso=%3Cscript%3E');
  await expect(page.getByRole('button', { name: BUTTON })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Settings: connect and disconnect', async ({ page }) => {
  await login(page, MATCH);
  await page.goto('/settings');
  const connect = page.getByRole('button', { name: 'Connect UIC' });
  await expect(connect).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Not connected')).toBeVisible();
  await expect(page.getByLabel('Current Password', { exact: true })).toBeVisible(); // changing the password is still here
  await expectAccessible(page, { label: 'settings: sign-in methods, not connected' });

  // Connecting asks for the current password first (a credential change).
  const dialog = page.getByRole('dialog');
  const confirmWith = async (password, button) => {
    await dialog.getByLabel('Current password').fill(password);
    await press(page, dialog.getByRole('button', { name: button }));
  };
  await press(page, connect);
  await expect(dialog).toContainText('Connect UIC');
  await expect(dialog).toHaveCSS('opacity', '1'); // fully faded in, or axe samples washed-out colors
  await expectAccessible(page, { include: '[role=dialog]', label: 'connect dialog' });
  await confirmWith('not-the-password', 'Continue');
  await expect(dialog.getByRole('alert')).toHaveText('That password isn’t right.');
  await expect(page).toHaveURL(/\/settings$/);

  // Cancelling at the provider comes back to Settings, not the login page.
  await providerWillSignIn(null);
  await confirmWith(MATCH.password, 'Continue');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-in was cancelled.' })).toBeVisible({ timeout: 15_000 });
  expect((await me(page)).signIn.sso).toBeNull();

  // Connect. The identity's own email differs from the account's: that's allowed here.
  const alias = `m.match@${SSO_DOMAIN}`;
  await providerWillSignIn(person('Morgan', 'Match', alias));
  await press(page, connect);
  await confirmWith(MATCH.password, 'Continue');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('status').filter({ hasText: 'UIC is now connected.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Connected as ${alias}`)).toBeVisible();
  await expectAccessible(page, { label: 'settings: sign-in methods, connected' });

  // Disconnect: also behind the current password.
  await press(page, page.getByRole('button', { name: 'Disconnect UIC' }));
  await expect(dialog).toContainText('Disconnect UIC?');
  await expect(dialog).toHaveCSS('opacity', '1');
  await expectAccessible(page, { include: '[role=dialog]', label: 'disconnect dialog' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await me(page)).signIn.sso).toBeTruthy();

  await press(page, page.getByRole('button', { name: 'Disconnect UIC' }));
  await confirmWith(MATCH.password, 'Disconnect');
  await expect(page.getByRole('status').filter({ hasText: 'UIC disconnected.' })).toBeVisible();
  await expect(connect).toBeVisible();
  expect((await me(page)).signIn.sso).toBeNull();
});

test('Signup: "Continue with UIC" from an invite link sent to a different email', async ({ page }) => {
  const invitedEmail = 'casey.personal@example.com';
  const { inviteToken } = await api('POST', '/v1/admin/invites', admin, { email: invitedEmail });
  try {
    await page.goto(`/signup?token=${inviteToken}`);
    const button = page.getByRole('button', { name: 'Continue with UIC' });
    await expect(button).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(invitedEmail);
    await expectAccessible(page, { label: 'signup with single sign-on' });

    await providerWillSignIn(person('Casey', 'Campus'));
    await press(page, button);
    await expect(page).toHaveURL(/\/lessons$/);
    await expect(page.getByRole('heading', { name: 'Lessons' })).toBeVisible({ timeout: 20_000 });
    // The account keeps the invite's email; the campus identity is connected to it.
    const account = await me(page);
    expect(account.email).toBe(invitedEmail);
    expect(account.signIn).toEqual({ password: false, sso: { provider: 'entra', email: `casey@${SSO_DOMAIN}` } });

    // The invite is spent.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/signup?token=${inviteToken}`);
    await expect(page.getByText('This invite can’t be used')).toBeVisible();
  } finally {
    await removeUser(admin, invitedEmail);
  }
});

// A 1 × 1 PNG.
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('the sign-in button carries the admin’s icon and colors, and nothing invalid', async ({ page }) => {
  const save = (settings) => api('PUT', '/v1/admin/plugins/entra-sso/settings', admin, { buttonLabel: BUTTON, ...settings });
  const look = (locator) => locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { height: el.offsetHeight, width: el.offsetWidth, radius: cs.borderRadius, font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, gap: cs.columnGap, padding: cs.paddingLeft };
  });
  let inviteToken;
  try {
    await page.goto('/login');
    const button = page.getByRole('button', { name: BUTTON, exact: true });
    await expect(button).toBeVisible();
    const before = await look(button);
    await expect(button.locator('img')).toHaveCount(0);

    await save({ buttonBackground: '#001E62', buttonTextColor: '#FFFFFF', buttonIcon: ICON });
    await page.reload();
    await expect(button).toBeVisible();
    await expect(button).toHaveCSS('background-color', 'rgb(0, 30, 98)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    // The icon: decorative, a fixed 20px square, left of the label.
    const icon = button.locator('img');
    await expect(icon).toHaveAttribute('src', ICON);
    await expect(icon).toHaveAttribute('alt', '');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    const box = await icon.boundingBox();
    expect([box.width, box.height]).toEqual([20, 20]);
    expect(await button.evaluate((el) => el.firstElementChild?.tagName)).toBe('IMG');
    // Same size, shape, font, and spacing as before, and as tall as the form's own button.
    expect(await look(button)).toEqual(before);
    const own = page.getByRole('button', { name: 'Sign in', exact: true });
    expect((await look(button)).height).toBe((await look(own)).height);
    expect((await look(button)).radius).toBe((await look(own)).radius);
    // By keyboard: the focus ring shows on the custom background.
    for (let i = 0; i < 6 && !(await button.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).not.toHaveCSS('box-shadow', 'none');
    await expectAccessible(page, { label: 'login with a styled single sign-on button' });

    // Signup's "Continue with UIC" is the same button.
    ({ inviteToken } = await api('POST', '/v1/admin/invites', admin, { email: 'styled.button@example.com' }));
    await page.goto(`/signup?token=${inviteToken}`);
    const cont = page.getByRole('button', { name: 'Continue with UIC' });
    await expect(cont).toHaveCSS('background-color', 'rgb(0, 30, 98)');
    await expect(cont.locator('img')).toHaveAttribute('src', ICON);
    await expectAccessible(page, { label: 'signup with a styled single sign-on button' });

    // Stored values that fail the rules are never served: a low-contrast
    // pair, an SVG, a remote image. The button is the site's default again.
    for (const bad of [
      { buttonBackground: '#ffffff', buttonTextColor: '#cccccc', buttonIcon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=' },
      { buttonBackground: '#001E62', buttonIcon: 'https://example.com/logo.png' },
    ]) {
      await save(bad);
      const res = await page.request.get('/v1/auth/sso/providers');
      expect(await res.json()).toEqual({ providers: [{ id: 'entra', label: BUTTON }] });
    }
    await page.goto('/login');
    await expect(button).toBeVisible();
    await expect(button.locator('img')).toHaveCount(0);
    expect(await button.getAttribute('style')).toBeNull();
    // An icon over the cap is refused at save.
    const big = await page.request.put('/v1/admin/plugins/entra-sso/settings', {
      headers: { Authorization: `Bearer ${admin}` }, data: { buttonLabel: BUTTON, buttonIcon: ICON + 'A'.repeat(20480) },
    });
    expect(big.status()).toBe(400);
  } finally {
    await save({}); // as global-setup left it
    if (inviteToken) await page.request.fetch(`/v1/admin/invites/${inviteToken}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
  }
});

test('a used or missing code shows the expired screen', async ({ page }) => {
  await page.goto('/sso/complete#code=not-a-real-code-000000');
  await expect(page.getByRole('heading', { name: 'That sign-in link has expired' })).toBeFocused();
  await expect(page.getByRole('alert')).toHaveText('That sign-in link has expired. Please try again.');
  await expect(page).toHaveURL(/\/sso\/complete$/);
  await press(page, page.getByRole('button', { name: 'Back to sign in' }));
  await expect(page).toHaveURL(/\/login$/);
});
