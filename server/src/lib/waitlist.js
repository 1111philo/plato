/**
 * Wait list (#363). People ask to join; an admin invites them from the Users
 * screen. Entries live in the invites table with status 'waitlist'.
 *
 * Config is its own record, `_system:waitlist` = `{ open, apiKeyHash }`, not
 * part of `_system:settings`, so a settings save from a stale page can't
 * bring back a revoked key.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import db from './db.js';
import { hashToken } from './crypto.js';
import { getFieldDefinitions, mergeFieldValues } from './user-fields.js';
import { readNameInput } from './names.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export async function readWaitlistConfig() {
  const item = await db.getSyncData('_system', 'waitlist');
  return { item, config: { open: false, apiKeyHash: null, ...(item?.data || {}) } };
}

export async function writeWaitlistConfig(item, config) {
  await db.putSyncData('_system', 'waitlist', config, item?.version || 0);
}

/**
 * A wait-list entry's key is derived from its email, so the create-only write
 * in db.createWaitlistEntry dedupes concurrent joins (the lookup-then-insert
 * in POST /v1/waitlist alone can't). Entries are only ever seen by admins and
 * can't be used to sign up (signup requires status 'pending'); an invite made
 * from an entry gets a fresh random token.
 */
export function waitlistTokenFor(email) {
  return 'inv_wl_' + createHash('sha256').update(String(email).trim().toLowerCase()).digest('base64url').slice(0, 32);
}

export function generateWaitlistApiKey() {
  return 'wlk_' + randomBytes(32).toString('base64url');
}

/** True when the `Authorization: Bearer <key>` header matches the stored key. */
export function hasValidApiKey(authHeader, config) {
  if (!config.apiKeyHash || typeof authHeader !== 'string') return false;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;
  const given = Buffer.from(hashToken(match[1]));
  const stored = Buffer.from(config.apiKeyHash);
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/**
 * Check a join request. First name (or a full `name`, split at the first
 * space, #402), email, every required custom field, and the group (if given,
 * it must be one of the classroom's groups).
 * Returns `{ email, profile }` or `{ error }`.
 */
export function validateWaitlistEntry(body, settings) {
  const { email, userGroup, customFields } = body || {};
  const nameInput = readNameInput(body, { required: true });
  if (nameInput.error) return { error: nameInput.error };
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return { error: 'A valid email is required' };
  if (email.trim().length > MAX_EMAIL_LENGTH) return { error: 'Email is too long' };

  let group = null;
  if (userGroup != null && userGroup !== '') {
    const groups = settings?.userGroups || [];
    if (typeof userGroup !== 'string' || !groups.includes(userGroup)) return { error: 'Unknown user group' };
    group = userGroup;
  }

  const merged = mergeFieldValues(getFieldDefinitions(settings), {}, customFields, { enforceRequired: true });
  if (merged.error) return { error: merged.error };

  return {
    email: email.trim().toLowerCase(),
    profile: { ...nameInput.fields, userGroup: group, customFields: merged.values },
  };
}
