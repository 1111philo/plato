// Bounced / spam-flagged addresses (server/src/lib/email-suppression.js).
// The e2e server runs with SUPPRESSED_EMAILS standing in for SES's list
// (playwright.config.js): bounced@example.com bounced, spam@example.com
// marked our email as spam.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { login, expectAccessible } from '../helpers.js';
import { ADMIN } from '../fixtures.js';
import { BASE_URL, DB_PATH } from '../playwright.config.js';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

test('an invite to a bounced address says it wasn’t sent, and the row is badged', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/plato/users');
  await page.getByRole('button', { name: /Invite Users/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email(s)').fill('bounced@example.com');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await dialog.getByRole('button', { name: 'Send 1 invite(s)' }).click();
  await expect(page.getByRole('alert')).toHaveText(/Not sent: bounced@example\.com bounced\. Check the address\./);
  const row = page.getByRole('row').filter({ hasText: 'bounced@example.com' });
  await expect(row.getByText('Email bounced')).toBeVisible();
  await expectAccessible(page, { label: 'users with a bounced invite' });

  // Clean up: revoke the invite so other specs see the same list.
  await row.getByRole('button', { name: 'Revoke invite for bounced@example.com' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'bounced@example.com' })).toHaveCount(0);
});

// Removing the address changes the server's stand-in list for the rest of the
// run, so a retry would start from the wrong state: don't retry this one.
test.describe('removing an address from the bounce list', () => {
  test.describe.configure({ retries: 0 });
test('Edit User shows the spam flag; an admin can take the address off the list', async ({ page }) => {
  execFileSync(process.execPath, ['scripts/create-dev-user.js', 'spam@example.com', 'spam-pass-123', 'Sam Spam'], {
    cwd: new URL('../../server/', import.meta.url),
    env: { ...process.env, DB_BACKEND: 'sqlite', SQLITE_PATH: DB_PATH },
    stdio: 'ignore',
  });
  const { accessToken } = await api('POST', '/v1/auth/login', null, { email: ADMIN.email, password: ADMIN.password });
  const users = await api('GET', '/v1/admin/users', accessToken);
  const { userId } = users.find((u) => u.email === 'spam@example.com');
  try {
    await login(page, ADMIN);
    await page.goto(`/plato/users/${userId}`);
    const note = page.getByRole('note', { name: 'Email delivery' });
    await expect(note).toContainText('Marked as spam.');
    await expect(note).toContainText('spam@example.com marked our email as spam');
    await expectAccessible(page, { label: 'edit user with a spam flag' });

    await note.getByRole('button', { name: 'Remove from the bounce list' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Remove from the bounce list?' });
    await expect(confirm).toBeVisible();
    await confirm.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectAccessible(page, { label: 'remove from bounce list confirm' });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('alert')).toHaveText('spam@example.com removed from the bounce list.');
    await expect(page.getByRole('note', { name: 'Email delivery' })).toHaveCount(0);
  } finally {
    await api('DELETE', `/v1/admin/users/${userId}`, accessToken);
  }
});
});
