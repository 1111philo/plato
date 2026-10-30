/**
 * Admin API helper — wraps authenticatedFetch for admin endpoints.
 */
import { authenticatedFetch, getCurrentUser } from '../../../js/auth.js';
import { isTester } from '../../lib/permissions.js';

export const TESTER_READ_ONLY_MESSAGE = 'Testers can look around but can’t save changes.';

export async function adminApi(method, path, body) {
  // Testers see every admin page; the server refuses their writes
  // (lib/permissions.js). Fail fast here with a clear message instead of a
  // bare 403. View as User (a read-only audit) is still allowed.
  if (method.toUpperCase() !== 'GET' && !path.startsWith('/v1/admin/impersonation/') && isTester(await getCurrentUser())) {
    const err = new Error(TESTER_READ_ONLY_MESSAGE);
    err.code = 'read_only_role';
    throw err;
  }
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const res = await authenticatedFetch(path, options);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    // Callers that need more than the message (e.g. a 409's `invalidCount`).
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
