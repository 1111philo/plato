import { randomBytes, createHash } from 'node:crypto';
import { USER_ID_PREFIX, INVITE_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX, RESET_TOKEN_PREFIX } from '../config.js';

export function generateUserId() {
  return USER_ID_PREFIX + randomBytes(16).toString('base64url');
}

export function generateInviteToken() {
  return INVITE_TOKEN_PREFIX + randomBytes(24).toString('base64url');
}

export function generateRefreshToken() {
  return REFRESH_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function generateResetToken() {
  return RESET_TOKEN_PREFIX + randomBytes(24).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
