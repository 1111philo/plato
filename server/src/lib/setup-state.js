/**
 * "Is this install set up?" (does any user exist), for the admin bootstrap
 * at cold start and `GET /v1/auth/setup-status`. Once true it stays true for
 * the life of the container: users are never all deleted (the last admin
 * can't be), so there's no need to ask DynamoDB again (#451 scale review,
 * B3). Before, every cold start and every SPA boot ran a full users Scan
 * (`countUsers`). `hasAnyUser` reads at most one item.
 */
import defaultDb from './db.js';

let setUp = false;

export async function isSetUp({ db = defaultDb } = {}) {
  if (setUp) return true;
  setUp = await db.hasAnyUser();
  return setUp;
}

/** Call after creating the first user. */
export function markSetUp() { setUp = true; }

/** For tests. */
export function _resetSetupState() { setUp = false; }
