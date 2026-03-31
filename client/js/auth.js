/**
 * Authentication module for plato.
 * Handles login, logout, token refresh, and authenticated requests.
 */

import {
  getAuthTokens, saveAuthTokens, clearAuth,
  getAuthUser, saveAuthUser
} from './storage.js';

// When served from the same origin (Lambda), use relative paths.
// Falls back to the Lambda Function URL for local development.
const SERVICE_URL = globalThis.__SERVICE_URL || '';

// -- Session expiry event -----------------------------------------------------

const _sessionExpiredListeners = new Set();

/**
 * Register a listener called when the session expires on another device
 * (refresh token was rotated). The listener receives no arguments.
 * Returns an unsubscribe function.
 */
export function onSessionExpired(fn) {
  _sessionExpiredListeners.add(fn);
  return () => _sessionExpiredListeners.delete(fn);
}

function _notifySessionExpired() {
  for (const fn of _sessionExpiredListeners) {
    try { fn(); } catch { /* listener errors must not propagate */ }
  }
}

/**
 * Log in with email and password.
 * Returns the user object on success, throws on failure.
 */
export async function login(email, password) {
  const res = await fetch(`${SERVICE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Login failed');
  }
  const { accessToken, refreshToken, user } = await res.json();
  await saveAuthTokens({ accessToken, refreshToken });
  await saveAuthUser(user);
  return user;
}

/**
 * Log out — clears local tokens and notifies the server.
 */
export async function logout() {
  const tokens = await getAuthTokens();
  if (tokens?.refreshToken) {
    try {
      await fetch(`${SERVICE_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
    } catch { /* best-effort server notification */ }
  }
  await clearAuth();
}

/**
 * Check if the user is logged in (has stored tokens).
 */
export async function isLoggedIn() {
  const tokens = await getAuthTokens();
  return !!tokens?.accessToken;
}

/**
 * Get the current user object, or null if not logged in.
 */
export { getAuthUser as getCurrentUser } from './storage.js';

/**
 * Refresh the access token using the stored refresh token.
 * Returns true on success, false on failure (user must re-login).
 */
async function refreshAccessToken() {
  const tokens = await getAuthTokens();
  if (!tokens?.refreshToken) return false;
  try {
    const res = await fetch(`${SERVICE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) {
      // Don't clear auth silently — the user's data should be preserved.
      // Notify listeners so the UI can prompt re-login.
      _notifySessionExpired();
      return false;
    }
    const { accessToken, refreshToken } = await res.json();
    await saveAuthTokens({ accessToken, refreshToken });
    return true;
  } catch {
    return false;
  }
}

/**
 * Make an authenticated request to the plato server.
 * Automatically refreshes the access token on 401.
 */
export async function authenticatedFetch(path, options = {}) {
  const tokens = await getAuthTokens();
  if (!tokens?.accessToken) throw new Error('Not logged in');

  const doFetch = (token) => fetch(`${SERVICE_URL}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  let res = await doFetch(tokens.accessToken);

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) throw new Error('Session expired');
    const newTokens = await getAuthTokens();
    res = await doFetch(newTokens.accessToken);
  }

  return res;
}


/**
 * Request a password reset email.
 */
export async function forgotPassword(email) {
  const res = await fetch(`${SERVICE_URL}/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
}

/**
 * Update the authenticated user's profile (name, password, etc.).
 * Returns the updated user object.
 */
export async function updateProfile(updates) {
  const res = await authenticatedFetch('/v1/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Update failed');
  }
  const data = await res.json();
  await saveAuthUser(data);
  return data;
}

/**
 * Fetch the API key assigned by the admin (if any).
 * Returns the key string or null.
 */
export async function getAssignedApiKey() {
  const res = await authenticatedFetch('/v1/me/api-key');
  if (!res.ok) return null;
  const { apiKey } = await res.json();
  return apiKey || null;
}
