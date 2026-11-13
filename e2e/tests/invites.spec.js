// Signup from an invite (tester feedback on #451): a dead invite says so
// before the form, an invite opened while signed in says who's signed in,
// and a username the server made up is shown once.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, LEARNER } from '../fixtures.js';
import { BASE_URL } from '../playwright.config.js';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function freshInvite(email) {
  const { accessToken } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  const { inviteToken } = await api('POST', '/v1/admin/invites', accessToken, { email });
  return inviteToken;
}

test('a used or unknown invite says so up front, with no form', async ({ page }) => {
  await page.goto('/signup?token=inv_not_a_real_token');
  await expect(page.getByText('This invite can’t be used')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expectAccessible(page, { label: 'invalid invite' });
  await page.getByRole('button', { name: 'Already have an account? Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('an invite opened while signed in says who is signed in', async ({ page }) => {
  const token = await freshInvite(`signed-in-${Date.now()}@example.com`);
  await login(page, LEARNER);
  await page.goto(`/signup?token=${token}`);
  await expect(page.getByRole('heading', { level: 1, name: 'This invite is for a new account' })).toBeVisible();
  await expect(page.getByText(LEARNER.email)).toBeVisible();
  await expectAccessible(page, { label: 'invite while signed in' });

  await page.getByRole('button', { name: 'Sign out and continue' }).click();
  await expect(page.getByLabel('Email')).toHaveValue(/signed-in-/); // the signup form, prefilled from the invite
  await expect(page).toHaveURL(new RegExp(`token=${token}`));
});

test('a dead invite opened while signed in says it can’t be used, without asking to sign out', async ({ page }) => {
  await login(page, LEARNER);
  await page.goto('/signup?token=inv_not_a_real_token');
  await expect(page.getByRole('heading', { level: 1, name: 'This invite can’t be used' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out and continue' })).toHaveCount(0);
  await expectAccessible(page, { label: 'dead invite while signed in' });
  await page.getByRole('button', { name: 'Go to my lessons' }).click();
  await expect(page).toHaveURL(/\/lessons$/);
});

test('a username the server makes up is shown once after signup', async ({ page }) => {
  const email = `blank-username-${Date.now()}@example.com`;
  const token = await freshInvite(email);
  await page.goto(`/signup?token=${token}`);
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await expect(page.getByLabel(/Username/)).toHaveAccessibleDescription(/make one for you/);
  await expectAccessible(page, { label: 'signup form from an invite' }); // /signup alone now shows the no-invite card
  await page.getByLabel('First name').fill('Blank');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/lessons$/, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: /^Your username is \S+\. You can change it in Settings\.$/ })).toBeVisible();
  await expectAccessible(page, { label: 'generated username notice' });
});

test('an invite sent to a mistyped address can be moved to the right one', async ({ page }) => {
  const api = async (method, path, token, body) => {
    const res = await page.request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
    expect(res.ok(), `${method} ${path}`).toBe(true);
    return res.json();
  };
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  const typo = 'moved-invitee@gmial.com';
  const right = 'moved-invitee@gmail.com';
  await api('POST', '/v1/admin/invites', admin, { email: typo });
  const oldToken = (await api('GET', '/v1/admin/invites', admin)).find((i) => i.email === typo).inviteToken;
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    await page.getByRole('button', { name: `Change email for the invite to ${typo}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Change invite email' });
    await expect(dialog).toContainText(typo);
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectAccessible(page, { include: '[role=dialog]', label: 'change invite email dialog' });
    await dialog.getByLabel('New email').fill(right);
    await dialog.getByRole('button', { name: 'Change and send' }).click();
    await expect(page.getByRole('alert').filter({ hasText: `Invite moved from ${typo} to ${right} and sent.` })).toBeVisible();
    const table = page.getByRole('table', { name: 'Users and invites' });
    await expect(table.getByRole('row').filter({ hasText: right })).toHaveCount(1);
    await expect(table.getByRole('row').filter({ hasText: typo })).toHaveCount(0);
    expect((await page.request.fetch(`/v1/auth/invite/${oldToken}`)).status()).toBe(404);
  } finally {
    for (const i of (await api('GET', '/v1/admin/invites', admin)).filter((x) => [typo, right].includes(x.email))) {
      await page.request.fetch(`/v1/admin/invites/${i.inviteToken}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
    }
  }
});
