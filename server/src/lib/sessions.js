/**
 * Sessions (#451 scale review: S1, S2, H1, S3).
 *
 * - **Session version.** `user.tokenVersion` (missing = 0) is stamped into
 *   every access token (`tv`) and stored on every refresh token. Bumping it
 *   (`revokeSessions`) ends every other session at once: `authenticate`
 *   refuses an access token whose `tv` doesn't match, and refresh refuses a
 *   refresh token issued under an older version. Bumped on password change,
 *   email change, and password reset; the person who made the change gets a
 *   fresh session in the same response.
 * - **Refresh rotation with a grace.** Exchanging a refresh token marks it
 *   rotated instead of deleting it; for REFRESH_GRACE_SECONDS it still works
 *   (tabs and parallel requests refreshing at once each get a new pair), then
 *   it expires. A rotated token used after the grace is refused.
 * - **Reset links.** Only the newest reset link per user works
 *   (`user.resetTokenHash`), and a user gets at most one reset email per
 *   RESET_COOLDOWN_MS. Reset tokens can't be used as refresh tokens.
 * - **Sign-in failures.** After LOGIN_MAX_FAILURES wrong passwords in a row,
 *   the account refuses sign-in for LOGIN_LOCK_MS (`failedLogins`,
 *   `lockedUntil`); a correct password resets the count.
 *
 * Every field is optional on the user record, so existing users need no
 * migration, and Beta-RC-232 ignores them all (rollback-safe).
 */
import defaultDb from './db.js';
import { generateRefreshToken, generateResetToken, hashToken } from './crypto.js';
import { signAccessToken } from './jwt.js';

export const REFRESH_GRACE_SECONDS = 30;
export const RESET_COOLDOWN_MS = 5 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export const sessionVersion = (user) => Number(user?.tokenVersion) || 0;

/** A new access + refresh pair for `user`, under its current session version. */
export async function issueSession(user, { db = defaultDb } = {}) {
  const tokenVersion = sessionVersion(user);
  const accessToken = await signAccessToken(user.userId, user.role, { tokenVersion });
  const refreshToken = generateRefreshToken();
  await db.storeRefreshToken(hashToken(refreshToken), user.userId, { tokenVersion });
  return { accessToken, refreshToken };
}

/** End every session of `user`. Returns the user with the new version. */
export async function revokeSessions(user, { db = defaultDb, extra = {} } = {}) {
  const tokenVersion = sessionVersion(user) + 1;
  await db.updateUser(user.userId, { tokenVersion, ...extra });
  return { ...user, ...extra, tokenVersion };
}

/**
 * Exchange a refresh token. Returns `{ user, accessToken, refreshToken }`, or
 * `{ error }` (always a 401 to the caller).
 */
export async function exchangeRefreshToken(refreshToken, { db = defaultDb, now = Date.now() } = {}) {
  const tokenHash = hashToken(refreshToken);
  const stored = await db.getRefreshToken(tokenHash);
  if (!stored) return { error: 'Invalid refresh token' };
  const user = await db.getUserById(stored.userId);
  if (!user) {
    await db.deleteRefreshToken(tokenHash);
    return { error: 'User not found' };
  }
  if ((Number(stored.tokenVersion) || 0) !== sessionVersion(user)) {
    await db.deleteRefreshToken(tokenHash);
    return { error: 'Session ended' };
  }
  if (stored.rotatedAt) {
    if (now - Date.parse(stored.rotatedAt) > REFRESH_GRACE_SECONDS * 1000) return { error: 'Invalid refresh token' };
  } else {
    await db.markRefreshTokenRotated(tokenHash, REFRESH_GRACE_SECONDS);
  }
  return { user, ...(await issueSession(user, { db })) };
}

/**
 * A reset link for `user`, unless one went out within the cooldown (then
 * null: the caller still answers ok). Only the newest link works.
 */
export async function issueResetToken(user, { db = defaultDb, now = Date.now(), force = false } = {}) {
  const last = Date.parse(user.resetRequestedAt || '');
  if (!force && Number.isFinite(last) && now - last < RESET_COOLDOWN_MS) return null;
  const token = generateResetToken();
  const tokenHash = hashToken(token);
  if (user.resetTokenHash) {
    try { await db.deleteResetToken(user.resetTokenHash); } catch { /* it may have expired already */ }
  }
  await db.storeResetToken(tokenHash, user.userId);
  await db.updateUser(user.userId, { resetTokenHash: tokenHash, resetRequestedAt: new Date(now).toISOString() });
  return token;
}

/**
 * The reset token's user, if the token is live and is that user's newest
 * link. (A user with no `resetTokenHash` predates this check: any live token
 * of theirs is accepted.)
 */
export async function resetTokenUser(resetToken, { db = defaultDb } = {}) {
  const tokenHash = hashToken(resetToken);
  const stored = await db.getResetToken(tokenHash);
  if (!stored) return null;
  const user = await db.getUserById(stored.userId);
  if (!user) {
    await db.deleteResetToken(tokenHash);
    return null;
  }
  if (user.resetTokenHash && user.resetTokenHash !== tokenHash) return null;
  return { user, tokenHash };
}

/** Is sign-in refused for now? */
export function signInLocked(user, now = Date.now()) {
  const until = Date.parse(user?.lockedUntil || '');
  return Number.isFinite(until) && until > now;
}

/** Record a wrong password; locks the account after LOGIN_MAX_FAILURES. */
export async function recordFailedSignIn(user, { db = defaultDb, now = Date.now() } = {}) {
  const failedLogins = (Number(user.failedLogins) || 0) + 1;
  const lock = failedLogins >= LOGIN_MAX_FAILURES;
  await db.updateUser(user.userId, {
    failedLogins: lock ? 0 : failedLogins,
    ...(lock ? { lockedUntil: new Date(now + LOGIN_LOCK_MS).toISOString() } : {}),
  });
  return lock;
}

/** A correct password: clear the failure count and any lock. */
export async function clearFailedSignIns(user, { db = defaultDb } = {}) {
  if (!user.failedLogins && !user.lockedUntil) return;
  await db.updateUser(user.userId, { failedLogins: 0, lockedUntil: null });
}
