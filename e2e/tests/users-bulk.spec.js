// Admin → Users: select users and change one thing for all of them (group or
// a user field), by keyboard.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN, EDUCATOR, TESTER, LEARNER } from '../fixtures.js';

test('admins update a group or a field for the users they select', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  const table = page.getByRole('table', { name: 'Users and invites' });
  const rowOf = (name) => table.getByRole('row').filter({ hasText: name });

  for (const u of [EDUCATOR, TESTER]) {
    await table.getByRole('checkbox', { name: `Select ${u.name}` }).focus();
    await page.keyboard.press('Space');
  }
  const bar = page.getByRole('region', { name: 'Selected users' });
  await expect(bar).toContainText('2 selected');
  await expect(table.getByRole('checkbox', { name: 'Select all users on this page' })).not.toBeChecked();
  await expectAccessible(page, { label: 'users with a selection' });

  // Set a group.
  await bar.getByRole('button', { name: 'Update…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Update 2 users' });
  await expect(dialog.getByLabel('What to change')).toHaveValue('userGroup');
  await dialog.getByLabel('New group').selectOption('Cohort A');
  await expect(dialog).toContainText('Sets Group to “Cohort A” for 2 users.');
  // Let the open animation finish (mid-fade, colors read as low contrast).
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await expectAccessible(page, { include: '[role=dialog]', label: 'bulk update dialog' });
  await dialog.getByRole('button', { name: 'Update 2 users' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Set Group to “Cohort A” for 2 users.' })).toBeVisible();
  await expect(bar).toHaveCount(0); // selection cleared after an update
  await expect(rowOf(EDUCATOR.name)).toContainText('Cohort A');
  await expect(rowOf(TESTER.name)).toContainText('Cohort A');

  // Set a field, then clear it and the group again (leave the seed as it was).
  const select = async () => {
    for (const u of [EDUCATOR, TESTER]) await table.getByRole('checkbox', { name: `Select ${u.name}` }).check();
  };
  await select();
  await bar.getByRole('button', { name: 'Update…' }).click();
  await dialog.getByLabel('What to change').selectOption({ label: 'Organization' });
  await dialog.getByLabel('New organization').fill('UIC');
  await dialog.getByRole('button', { name: 'Update 2 users' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Set Organization to “UIC” for 2 users.' })).toBeVisible();

  for (const [what, clear] of [['Organization', 'Clear it'], ['Group', 'Remove from their group']]) {
    await select();
    await bar.getByRole('button', { name: 'Update…' }).click();
    await dialog.getByLabel('What to change').selectOption({ label: what });
    await dialog.getByRole('radio', { name: clear }).check();
    await expect(dialog).toContainText(`Clears ${what} for 2 users.`);
    await dialog.getByRole('button', { name: 'Update 2 users' }).click();
    await expect(page.getByRole('alert').filter({ hasText: `Cleared ${what} for 2 users.` })).toBeVisible();
  }
  await expect(rowOf(EDUCATOR.name)).not.toContainText('Cohort A');
});

test('a new search empties the selection', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  const table = page.getByRole('table', { name: 'Users and invites' });
  await table.getByRole('checkbox', { name: 'Select all users on this page' }).check();
  await expect(page.getByRole('region', { name: 'Selected users' })).toBeVisible();
  await page.getByLabel('Search users').fill('e');
  await expect(page.getByRole('region', { name: 'Selected users' })).toHaveCount(0);
});

test('wait-list entries can be selected and updated; someone on the list with an account gets it on both', async ({ page }) => {
  const api = async (method, path, token, body) => {
    const res = await page.request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
    expect(res.ok(), `${method} ${path}`).toBe(true);
    return res.json();
  };
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: true });
  await api('POST', '/v1/waitlist', null, { name: 'Wren Waiting', email: 'wren@example.com' });
  await api('POST', '/v1/waitlist', null, { name: LEARNER.name, email: LEARNER.email }); // also has an account
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: false });
  const { userFields } = await api('GET', '/v1/admin/user-fields', admin);
  const org = userFields.find((f) => f.label === 'Organization');

  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('menu').getByRole('menuitemcheckbox', { name: /^Wait list/ }).click();
    await page.keyboard.press('Escape');
    const table = page.getByRole('table', { name: 'Users and invites' });
    await expect(table.getByRole('row').filter({ hasText: 'Wren Waiting' })).toHaveCount(1);
    await table.getByRole('checkbox', { name: 'Select all users on this page' }).check();
    const bar = page.getByRole('region', { name: 'Selected users' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Update…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Update 2 users' });
    await dialog.getByLabel('What to change').selectOption({ label: 'Organization' });
    await dialog.getByLabel('New organization').fill('Acme');
    await dialog.getByRole('button', { name: 'Update 2 users' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Set Organization to “Acme” for 2 users.' })).toBeVisible();

    const { entries } = await api('GET', '/v1/admin/waitlist', admin);
    for (const email of ['wren@example.com', LEARNER.email]) {
      expect(entries.find((e) => e.email === email).customFields[org.id]).toBe('Acme');
    }
    const users = await api('GET', '/v1/admin/users', admin);
    const list = Array.isArray(users) ? users : users.users;
    expect(list.find((u) => u.email === LEARNER.email).customFields[org.id], 'the account too').toBe('Acme');
  } finally {
    const { entries } = await api('GET', '/v1/admin/waitlist', admin);
    for (const e of entries.filter((x) => ['wren@example.com', LEARNER.email].includes(x.email))) {
      await api('DELETE', `/v1/admin/waitlist/${e.inviteToken}`, admin);
    }
    const users = await api('GET', '/v1/admin/users', admin);
    const learner = (Array.isArray(users) ? users : users.users).find((u) => u.email === LEARNER.email);
    await api('POST', '/v1/admin/users/bulk-update', admin, { userIds: [learner.userId], set: { field: org.id, value: null } });
  }
});

test('admins invite selected wait-list entries in one go', async ({ page }) => {
  const api = async (method, path, token, body) => {
    const res = await page.request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
    expect(res.ok(), `${method} ${path}`).toBe(true);
    return res.json();
  };
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: true });
  for (const n of [1, 2, 3]) await api('POST', '/v1/waitlist', null, { name: `Bulk Invitee ${n}`, email: `bulk-invitee-${n}@example.com` });
  await api('PUT', '/v1/admin/waitlist/settings', admin, { open: false });
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('menu').getByRole('menuitemcheckbox', { name: /^Wait list/ }).click();
    await page.keyboard.press('Escape');
    const table = page.getByRole('table', { name: 'Users and invites' });
    await table.getByRole('checkbox', { name: 'Select all users on this page' }).check();
    const bar = page.getByRole('region', { name: 'Selected users' });
    await bar.getByRole('button', { name: 'Invite 3 from the wait list' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Invite 3 from the wait list?' }).or(page.getByRole('dialog', { name: 'Invite 3 from the wait list?' }));
    await expect(confirm).toBeVisible();
    await confirm.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectAccessible(page, { label: 'bulk invite confirm' });
    await confirm.getByRole('button', { name: 'Invite 3' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invited 3 people from the wait list.' })).toBeVisible();
    const invites = await api('GET', '/v1/admin/invites', admin);
    for (const n of [1, 2, 3]) expect((Array.isArray(invites) ? invites : invites.invites).some((i) => i.email === `bulk-invitee-${n}@example.com` && i.status === 'pending')).toBe(true);
  } finally {
    const invites = await api('GET', '/v1/admin/invites', admin);
    for (const i of (Array.isArray(invites) ? invites : invites.invites).filter((x) => /^bulk-invitee-/.test(x.email))) {
      await page.request.fetch(`/v1/admin/invites/${i.inviteToken}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
    }
    const { entries } = await api('GET', '/v1/admin/waitlist', admin);
    for (const e of entries.filter((x) => /^bulk-invitee-/.test(x.email))) await api('DELETE', `/v1/admin/waitlist/${e.inviteToken}`, admin);
  }
});

test('an expired invite is kept, marked, and resent in bulk with a fresh link', async ({ page }) => {
  const api = async (method, path, token, body) => {
    const res = await page.request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
    expect(res.ok(), `${method} ${path}`).toBe(true);
    return res.json();
  };
  const { accessToken: admin } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  const email = 'expired-invitee@example.com';
  await api('POST', '/v1/admin/invites', admin, { email });
  // Age it past its 7 days, straight in the e2e database.
  const { execFileSync } = await import('node:child_process');
  const { DB_PATH } = await import('../playwright.config.js');
  execFileSync(process.execPath, ['-e', `const D=require('better-sqlite3');const d=new D(process.argv[1]);d.prepare("UPDATE invites SET expiresAt=? WHERE email=?").run(Math.floor(Date.now()/1000)-60, process.argv[2]);d.close();`, DB_PATH, email], { cwd: new URL('../../server/', import.meta.url) });
  try {
    await login(page, ADMIN);
    await page.goto('/plato/users');
    const table = page.getByRole('table', { name: 'Users and invites' });
    const row = table.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('Invite expired');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('menu').getByRole('menuitemcheckbox', { name: /^Invite expired/ }).click();
    await page.keyboard.press('Escape');
    await row.getByRole('checkbox', { name: `Select ${email}` }).check();
    const bar = page.getByRole('region', { name: 'Selected users' });
    await expect(bar.getByRole('button', { name: 'Update…' })).toHaveCount(0); // invites have no fields
    await bar.getByRole('button', { name: 'Resend 1 invite' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Resend 1 invite?' }).or(page.getByRole('dialog', { name: 'Resend 1 invite?' }));
    await confirm.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectAccessible(page, { label: 'bulk resend confirm' });
    await confirm.getByRole('button', { name: 'Resend 1' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Resent 1 invite with a new 7-day link.' })).toBeVisible();
    const list = await api('GET', '/v1/admin/invites', admin);
    const fresh = (Array.isArray(list) ? list : list.invites).filter((i) => i.email === email && i.status === 'pending');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].expired).toBe(false);
  } finally {
    const list = await api('GET', '/v1/admin/invites', admin);
    for (const i of (Array.isArray(list) ? list : list.invites).filter((x) => x.email === email)) {
      await page.request.fetch(`/v1/admin/invites/${i.inviteToken}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
    }
  }
});
