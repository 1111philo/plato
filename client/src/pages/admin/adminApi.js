/**
 * Admin API helper — wraps authenticatedFetch for admin endpoints.
 */
import { authenticatedFetch } from '../../../js/auth.js';

export async function adminApi(method, path, body) {
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
