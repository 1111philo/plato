import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authModule from '../../js/auth.js';
import { init as initDatabase, clearAllData } from '../../js/db.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    authModule.isLoggedIn().then(async (result) => {
      setLoggedIn(result);
      if (result) setUser(await authModule.getCurrentUser());
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
    await authModule.logout();
    await clearAllData();
    await initDatabase();
    setLoggedIn(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loggedIn, user, loading, login, logout, refreshUser, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
