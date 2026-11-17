import db from './db.js';
import { randomBytes } from 'node:crypto';

export function generateUsername() {
  return 'user-' + randomBytes(3).toString('hex');
}

/**
 * A generated username nobody has yet. The random part is small (16.7M), and
 * DynamoDB's createUser only conditions on userId, so a collision would
 * create a second account with the same username. Returns null if every try
 * is taken (practically never).
 */
export async function uniqueUsername({ generate = generateUsername, tries = 5 } = {}) {
  for (let i = 0; i < tries; i++) {
    const candidate = generate();
    if (!(await db.getUserByUsername(candidate))) return candidate;
  }
  return null;
}
