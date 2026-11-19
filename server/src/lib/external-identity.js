/**
 * Which plato account a single sign-on identity lands in. The only place that
 * decides: routes/sso.js calls `resolveSignIn` after the ID token has been
 * verified (lib/oidc.js) and mapped by the provider (lib/sso-providers.js).
 *
 * Rules, in order (decided 2026-11-17; see docs/SSO.md):
 *  0. Connecting from Settings: nothing is linked at the callback. The
 *     identity is handed back (`pending_link`) and linked only when the
 *     signed-in person who started it finishes the exchange (routes/sso.js),
 *     so a planted cookie can't attach anyone's identity to another account.
 *  1. The identity is already linked to an account → that account. A stored
 *     link always wins, whatever emails say now.
 *  2. A vouched-for email matches an account → link it and sign in (everyone,
 *     staff included), and tell the account by email. plato accepts emails
 *     nobody proved (a learner can change theirs; a shareable invite takes
 *     any), so someone could park an account on another person's address and
 *     wait for them. Unless the account's email was proven
 *     (`emailVerifiedAt`: an emailed invite or reset link was used), the link
 *     is a takeover by the address's real owner: every session ends and the
 *     password is removed.
 *  3. They came from an invite link → create the account from the invite. An
 *     email invite keeps the invite's email (holding the link is the proof, as
 *     with password signup) and must not be expired; a shareable link uses the
 *     identity's email and counts against its limit.
 *  4. A vouched-for email has an invite, pending or expired → create the
 *     account from it (the identity proves the address, so the link's expiry
 *     doesn't matter).
 *  5. Otherwise no account is made (invite only). If a vouched-for email is on
 *     the wait list, the entry is marked verified.
 *
 * One identity belongs to one account, and an account has one identity:
 * `ssoKey` on the user ('<provider>:<tenant>:<subject>').
 */
import defaultDb from './db.js';
import { generateUserId } from './crypto.js';
import { uniqueUsername } from './usernames.js';
import { inviteExpired } from './invite-expiry.js';
import { nameFields } from './names.js';
import { getFieldDefinitions, visibleFieldValues } from './user-fields.js';
import { emit as emitHook } from './plugins/hooks.js';
import { revokeSessions } from './sessions.js';
import { logger } from './logger.js';

export const ssoKeyFor = (providerId, identity) => `${providerId}:${identity.tenant || '-'}:${identity.subject}`;

const audit = async (db, entry) => { try { await db.createAuditLog(entry); } catch { /* best-effort */ } };

async function createAccount({ db, email, identity, key, profile = null, slackUserId = null }) {
  if (await db.getUserByEmail(email)) return { outcome: 'error', code: 'account_exists' };
  const username = await uniqueUsername();
  if (!username) return { outcome: 'error', code: 'try_again' };
  const settings = (await db.getSyncData('_system', 'settings'))?.data || {};
  // The name comes from one source, whole: the invite's (what the person or an
  // admin entered; older profiles hold a single `name`), else the provider's.
  // Never one part from each.
  const invited = profile && (profile.firstName || profile.name) ? nameFields(profile) : null;
  const firstName = ((invited ? invited.firstName : identity.firstName) || '').trim().slice(0, 100);
  const lastName = ((invited ? invited.lastName : identity.lastName) || '').trim().slice(0, 100);
  const fallback = (identity.name || email.split('@')[0]).trim().slice(0, 100);
  const userId = generateUserId();
  try {
    await db.createUser({
      userId,
      email,
      username,
      firstName: firstName || fallback,
      lastName,
      name: [firstName || fallback, lastName].filter(Boolean).join(' '),
      // A group renamed or deleted since the person joined the wait list is dropped.
      userGroup: profile?.userGroup && (settings.userGroups || []).includes(profile.userGroup) ? profile.userGroup : null,
      role: 'learner', // never from the provider's claims
      slackUserId,
      customFields: visibleFieldValues(getFieldDefinitions(settings), profile?.customFields),
      sso: { key, email: identity.email },
      // Proven either by the provider or by holding the emailed invite link.
      emailVerifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    // The identity or the account appeared meanwhile (two sign-ins at once).
    if (err.name === 'ConditionalCheckFailedException') return { outcome: 'error', code: 'try_again' };
    throw err;
  }
  await emitHook('userCreated', { userId, email, role: 'learner' });
  return { outcome: 'signed_in', userId, created: true };
}

/**
 * `identity`: `{ subject, tenant, emails, email, firstName, lastName, name }`.
 * Returns `{ outcome: 'signed_in', userId, created?, linked? }`,
 * `{ outcome: 'linked', userId }`, `{ outcome: 'no_account', onWaitlist, ... }`,
 * or `{ outcome: 'error', code }`.
 */
export async function resolveSignIn({ providerId, identity, inviteToken = null, linkUserId = null, db = defaultDb, notifyLinked = null }) {
  if (!identity?.subject) return { outcome: 'error', code: 'no_subject' };
  const key = ssoKeyFor(providerId, identity);
  const emails = [...new Set((identity.emails || []).map((e) => String(e).toLowerCase()))];
  const owner = await db.getUserBySsoKey(key);

  // 0. Connect from Settings: decided at the exchange (finishLink), not here.
  if (linkUserId) {
    if (owner && owner.userId !== linkUserId) return { outcome: 'error', code: 'identity_in_use' };
    return { outcome: 'pending_link', userId: linkUserId, key, email: identity.email || null };
  }

  // 1. Known identity.
  if (owner) return { outcome: 'signed_in', userId: owner.userId };

  // 2. A vouched-for email matches an account.
  for (const email of emails) {
    const user = await db.getUserByEmail(email);
    if (!user) continue;
    if (user.ssoKey) return { outcome: 'error', code: 'account_has_identity' };
    if (!(await db.linkUserSso(user.userId, { key, email: identity.email }))) return { outcome: 'error', code: 'account_has_identity' };
    // Nobody proved this account's email: whoever made it may not be the
    // address's owner. The owner is here now, so end every session and remove
    // the password. A proven email keeps both.
    const takeover = !user.emailVerifiedAt;
    if (takeover) await revokeSessions(user, { db, extra: { passwordHash: '', resetTokenHash: null, failedLogins: 0, lockedUntil: null } });
    await db.updateUser(user.userId, { emailVerifiedAt: new Date().toISOString() });
    await audit(db, { action: 'sso_linked', userId: user.userId, email: user.email, performedBy: user.userId, details: { provider: providerId, how: 'email', passwordRemoved: takeover } });
    if (notifyLinked) { try { await notifyLinked(user, { passwordRemoved: takeover }); } catch (err) { logger.warn('sso_link_notice_failed', { reason: err?.code || err?.name || 'error' }); } }
    return { outcome: 'signed_in', userId: user.userId, linked: true, passwordRemoved: takeover };
  }

  // 3. From an invite link.
  if (inviteToken) {
    const invite = await db.getInvite(inviteToken);
    if (!invite || invite.status !== 'pending' || invite.forUserId || inviteExpired(invite)) return { outcome: 'error', code: 'invite_invalid' };
    let result;
    if (invite.email) {
      result = await createAccount({ db, email: invite.email.toLowerCase(), identity, key, profile: invite.profile, slackUserId: invite.slackUserId });
      if (result.outcome === 'signed_in') await db.markInviteUsed(inviteToken);
    } else if (invite.isLink) {
      // A shareable link takes any typed email at password signup, but an
      // account shown as "connected" must carry an address the provider vouches for.
      const vouched = emails[0];
      if (!vouched) return { outcome: 'error', code: 'no_email' };
      if (await db.getUserByEmail(vouched)) return { outcome: 'error', code: 'account_exists' };
      try {
        await db.incrementLinkUsage(inviteToken); // atomic: gates creation at the limit
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') return { outcome: 'error', code: 'invite_full' };
        throw err;
      }
      result = await createAccount({ db, email: vouched, identity, key });
      if (result.outcome === 'signed_in') {
        const updated = await db.getInvite(inviteToken);
        if (updated?.maxUsages && updated.usageCount >= updated.maxUsages) await db.markInviteUsed(inviteToken);
      }
    } else {
      return { outcome: 'error', code: 'invite_invalid' };
    }
    if (result.outcome === 'signed_in') await audit(db, { action: 'sso_account_created', userId: result.userId, email: invite.email || identity.email, performedBy: result.userId, details: { provider: providerId, via: invite.isLink ? 'invite_link' : 'invite' } });
    return result;
  }

  // 4. A vouched-for email has an invite (pending or expired).
  for (const email of emails) {
    const invite = await db.getInviteByEmail(email);
    if (!invite || invite.forUserId) continue;
    const result = await createAccount({ db, email, identity, key, profile: invite.profile, slackUserId: invite.slackUserId });
    if (result.outcome === 'signed_in') {
      await db.markInviteUsed(invite.inviteToken);
      await audit(db, { action: 'sso_account_created', userId: result.userId, email, performedBy: result.userId, details: { provider: providerId, via: 'invite_email' } });
    }
    return result;
  }

  // 5. Invite only: nobody is created. Mark a wait-list entry as verified.
  let onWaitlist = false;
  for (const email of emails) {
    const entry = await db.getWaitlistEntryByEmail(email);
    if (!entry) continue;
    onWaitlist = true;
    if (!entry.profile?.ssoVerified) {
      try {
        // Anyone can join the public list under someone else's address. The
        // mark vouches for the email only, so take the name from the provider;
        // the group and answers stay as submitted (admins see "Email verified").
        const named = identity.firstName ? { firstName: identity.firstName.trim().slice(0, 100), lastName: (identity.lastName || '').trim().slice(0, 100) } : {};
        await db.updateWaitlistEntry(entry.inviteToken, { email: entry.email, profile: { ...(entry.profile || {}), ...named, ssoVerified: { provider: providerId, at: new Date().toISOString() } } });
      } catch { /* invited or removed meanwhile */ }
    }
    break;
  }
  return { outcome: 'no_account', onWaitlist };
}

/**
 * Finish "Connect" from Settings: link the identity a callback handed back
 * (`pending_link`) to the signed-in account that started it. Called from the
 * exchange, behind authentication. Returns `{ outcome: 'linked' }` or an error.
 */
export async function finishLink({ providerId, pending, userId, db = defaultDb, notifyLinked = null }) {
  if (!pending?.key || pending.userId !== userId) return { outcome: 'error', code: 'try_again' };
  const owner = await db.getUserBySsoKey(pending.key);
  if (owner) return owner.userId === userId ? { outcome: 'linked', userId } : { outcome: 'error', code: 'identity_in_use' };
  const user = await db.getUserById(userId);
  if (!user) return { outcome: 'error', code: 'try_again' };
  if (user.ssoKey) return { outcome: 'error', code: 'account_has_identity' };
  if (!(await db.linkUserSso(userId, { key: pending.key, email: pending.email }))) return { outcome: 'error', code: 'identity_in_use' };
  await audit(db, { action: 'sso_linked', userId, email: user.email, performedBy: userId, details: { provider: providerId, how: 'settings' } });
  if (notifyLinked) { try { await notifyLinked(user, { passwordRemoved: false }); } catch (err) { logger.warn('sso_link_notice_failed', { reason: err?.code || err?.name || 'error' }); } }
  return { outcome: 'linked', userId };
}
