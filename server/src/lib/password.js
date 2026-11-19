import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../config.js';

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// An account made by single sign-on has no password. Compare against a
// throwaway hash anyway (made on first use), so the answer takes as long as a
// wrong password does.
let noPassword;
export async function comparePassword(password, hash) {
  if (!hash) {
    noPassword ||= bcrypt.hash('plato-no-password', BCRYPT_ROUNDS);
    await bcrypt.compare(String(password || ''), await noPassword);
    return false;
  }
  return bcrypt.compare(password, hash);
}
