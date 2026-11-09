// The learner's own profile notes (#451 testing): listed under Settings →
// Learner Profile, kept through later updates, and removable.
import { test, expect } from '@playwright/test';
import { login, expectAccessible } from '../helpers.js';
import { LEARNER } from '../fixtures.js';

test('a learner sees the notes they gave plato and can remove one by keyboard', async ({ page, request }) => {
  const { accessToken } = await (await request.post('/v1/auth/login', { data: { email: LEARNER.email, password: LEARNER.password } })).json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  const current = await (await request.get('/v1/sync/profile', { headers: auth })).json();
  const profile = { ...(current.data || {}), learnerNotes: [{ text: 'This is a QA test account.', at: 1 }] };
  expect((await request.put('/v1/sync/profile', { headers: auth, data: { data: profile, version: current.version || 0 } })).ok()).toBe(true);

  await login(page, LEARNER);
  await page.goto('/settings');
  const notes = page.getByRole('list', { name: 'Your notes' });
  await expect(notes.getByRole('listitem')).toHaveText(/This is a QA test account\./, { timeout: 15_000 });
  await expectAccessible(page, { label: 'settings learner notes' });

  const remove = notes.getByRole('button', { name: 'Remove note: This is a QA test account.' });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Your notes' })).toHaveCount(0);

  const after = await (await request.get('/v1/sync/profile', { headers: auth })).json();
  expect(after.data.learnerNotes).toEqual([]);
});
