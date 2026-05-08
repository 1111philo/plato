import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authModule from '../../js/auth.js';
import { authenticatedFetch } from '../../js/auth.js';
import { clearCache } from '../../js/storage.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  // "View as User" admin feature: when set, the SPA renders the classroom
  // as if this user were logged in (read-only). Persisted in sessionStorage
  // by auth.js so authenticatedFetch can attach `?asUserId=` to GETs.
  const [impersonatedUser, setImpersonatedUserState] = useState(null);

  useEffect(() => {
    authModule.isLoggedIn().then(async (result) => {
      setLoggedIn(result);
      if (result) {
        const u = await authModule.getCurrentUser();
        setUser(u);
        // Restore impersonation only if the logged-in user is admin.
        // A non-admin should never have impersonation state lingering;
        // clear defensively if found.
        const stashed = authModule.getImpersonation();
        if (stashed && u?.role === 'admin') {
          setImpersonatedUserState(stashed);
        } else if (stashed) {
          authModule.setImpersonation(null);
        }
      }
      setLoading(false);
    });
  }, []);

  // Listen for session expiry (e.g. refresh token rotated by another device)
  useEffect(() => {
    return authModule.onSessionExpired(() => setSessionExpired(true));
  }, []);

  const login = useCallback(async (email, password) => {
    const authUser = await authModule.login(email, password);
    setLoggedIn(true);
    setUser(authUser);
    setSessionExpired(false);
    return authUser;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await authModule.getCurrentUser();
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    // Always exit impersonation before logging out so the next session
    // doesn't inherit a stale view.
    if (authModule.getImpersonation()) {
      authModule.setImpersonation(null);
      clearCache();
    }
    setImpersonatedUserState(null);
    await authModule.logout();
    setLoggedIn(false);
    setUser(null);
  }, []);

  const startImpersonation = useCallback(async (targetUserId) => {
    const res = await authenticatedFetch('/v1/admin/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to start impersonation');
    }
    const target = await res.json();
    authModule.setImpersonation(target);
    clearCache(); // admin's own sync-data must not leak into target's view
    setImpersonatedUserState(target);
    return target;
  }, []);

  const stopImpersonation = useCallback(async () => {
    const current = authModule.getImpersonation();
    authModule.setImpersonation(null);
    clearCache(); // target's data must not linger after exit
    setImpersonatedUserState(null);
    // Best-effort end notification — don't block the UI on it.
    try {
      await authenticatedFetch('/v1/admin/impersonation/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: current?.userId }),
      });
    } catch { /* audit-log is best-effort; the start entry is the source of truth */ }
  }, []);

  return (
    <AuthContext.Provider value={{
      loggedIn, user, loading, login, logout, refreshUser, sessionExpired,
      impersonatedUser, startImpersonation, stopImpersonation,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
